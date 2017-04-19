let request = require('./request').request;
let FileCache = require('./request').FileCache;
let cacheWrapper = require('./request').cacheWrapper;
let AdmZip = require('adm-zip');
let Stream = require('./stream');

class SRTM {
    constructor(options) {
        this.options = options;
        this.request = request;
        this.getSrtmFileUrlPromise = undefined;
        this.hgtContentPromise = {};
        if (this.options.cacheFolder) {
            this.fileCache = new FileCache(this.options.cacheFolder);
            this.request = cacheWrapper(request, this.fileCache);
            this.buildingIndexPromise = undefined;
        }
    }

    getSrtmUrl() {
        throw new Error('Must be implemented by child class');
    }

    getHgtDataSize() {
        throw new Error('Must be implemented by child class');
    }

    async getLinksFromUrl(url, filter) {
        filter = filter || ((value) => { return true; });
        let data = await this.request(url);
        let links = data.toString()
            .replace(/.*<a href="/g, '^')
            .replace(/">.*/g, '')
            .split("\n")
            .filter((row) => { return row[0] === '^'; })
            .map((row) => { return row.substr(1); })
            .filter(filter);
        return links;
    }

    path2coordinates(path) {
        let filename = path.split('/').pop();
        let base = filename.split('.')[0];
        let match = base.match(/(S|N)(\d+)(E|W)(\d+)/);
        if (!match) {
            throw new Error('Filename does not follow lat lon format e.g. S09E005. "' + path + '"');
        }
        let fileLat = (match[1] === 'S' ? -1 : 1) * match[2];
        let fileLon = (match[3] === 'W' ? -1 : 1) * match[4];
        return [fileLon, fileLat];
    }

    async getSrtmFileUrl(lon, lat) {
        let linkFilter = (link) => {
            try {
                let coords = this.path2coordinates(link);
                let fileLat = coords[1];
                let fileLon = coords[0];
                if (fileLat <= lat && fileLat + 1 >= lat && fileLon <= lon && fileLon + 1 >= lon) {
                    return true;
                }
                return false;
            } catch (err) {
                return false;
            }
        };

        let getLinks = async (url) => {
            let result = [];
            let filter = (link) => {
                return link[0] !== '/' && link[0] !== '.'
                    && (link.indexOf('.') !== -1 && linkFilter(link) || link.indexOf('.') === -1);
            };
            let links = await this.getLinksFromUrl(url, filter);
            for (let i = 0; i < links.length; i++) {
                let link = links[i];
                if (link.indexOf('.') !== -1) {
                    result.push(url + link);
                } else {
                    result = result.concat(await getLinks(url + link));
                }
            }
            return result;
        };


        if (!this.getSrtmFileUrlPromise) {
            this.getSrtmFileUrlPromise = getLinks(this.getSrtmUrl()).then((links) => {
                return links.length > 0 ? links[0] : undefined;
                this.getSrtmFileUrlPromise = undefined;
            });
        }
        return this.getSrtmFileUrlPromise;
    }

    async createIndex(indexLinks, indexOffsets) {
        let offset = 0;
        let map = [];
        let filter = (link) => {
            return link[0] !== '/' && link[0] !== '.';
        };
        let linksToStream = async (url) => {

            let links = await this.getLinksFromUrl(url);
            for (let i = 0; i < links.length; i++) {
                let link = links[i];
                if (filter(link) === false) {
                    continue;
                }
                if (link.indexOf('.') !== -1) {
                    let fullLink = url + link + "\n";
                    let len = fullLink.length;
                    await indexLinks.write(fullLink);
                    let coords;
                    try {
                        coords = this.path2coordinates(link);
                    } catch (err) {
                        continue;
                    }
                    let lon = coords[0] + 180;
                    let lat = coords[1] + 90;
                    let index = '' + String('000' + lon).slice(-3) + ':' + String('000' + lat).slice(-3);
                    if (map[index]) {
                        throw new Error('Index ' + index + ' already defined');
                    }
                    map[index] = String('0000000000' + offset).slice(-10) + ':' + String('00000' + len).slice(-5) + "\n";
                    offset += len;
                } else {
                    await linksToStream(url + link);
                }
            }
        };

        await linksToStream(this.getSrtmUrl());

        for (let lon = 0; lon < 360; lon++) {
            for (let lat = 0; lat < 180; lat++) {
                let index = '' + String('000' + lon).slice(-3) + ':' + String('000' + lat).slice(-3);
                if (!map[index]) {
                    await indexOffsets.write(index + ':N               ' + "\n");
                } else {
                    await indexOffsets.write(index + ':' + map[index]);
                }
            }
        }
    }

    async getElevation(lon, lat) {
        let url;
        if (this.fileCache) {
            // longitude + 180 -> 0 - 359
            // latitude + 90 -> 0 - 179
            let normLon = Math.floor(lon + 180);
            let normLat = Math.floor(lat + 90);
            let indexOffset = (normLat * 25) + (normLon * (180 * 25));
            let metaData;
            try {
                metaData = await this.fileCache.read('__index_offsets__', indexOffset, 24);
            } catch (err) {
                throw err;
            }
            if (!metaData) {
                // build index
                let buildIndex = async () => {
                    let indexLinks = new Stream();
                    await this.fileCache.write('__index_links__', indexLinks);
                    let indexOffsets = new Stream();
                    await this.fileCache.write('__index_offsets__', indexOffsets);
                    try {
                        await this.createIndex(indexLinks, indexOffsets);
                    } catch (err) {
                        console.error(err);
                    }
                };
                if (!this.buildingIndexPromise) {
                    this.buildingIndexPromise = buildIndex();
                }
                await this.buildingIndexPromise;
                metaData = await this.fileCache.read('__index_offsets__', indexOffset, 24);
            }
            let parts = metaData.toString().split(':');
            let offset = parseInt(parts[2]);
            let length = parseInt(parts[3]) - 1;
            url = await this.fileCache.read('__index_links__', offset, length);
            url = url.toString();
        } else {
            url = await this.getSrtmFileUrl(lon, lat);
        }
        if (!url) {
            return 0;
        }
        let nonZipUrl = url.replace(/\.zip$/, '');
        let hgtContent;

        let getHgtContent = async () => {
            if (this.fileCache) {
                let hgtContentTest = await this.fileCache.read(nonZipUrl, 0, 1);
                if (hgtContentTest === undefined) {
                    let content = await request(url);
                    let zip = new AdmZip(content);
                    let zipEntries = zip.getEntries();
                    await this.fileCache.write(nonZipUrl, zip.readFile(zipEntries[0]));
                }
            } else {
                let content = await this.request(url);
                let zip = new AdmZip(content);
                let zipEntries = zip.getEntries();
                return zip.readFile(zipEntries[0]);
            }
        };

        if (!this.hgtContentPromise[url]) {
            this.hgtContentPromise[url] = getHgtContent().then(() => {
                this.hgtContentPromise[url] = undefined;
            });
        }

        await this.hgtContentPromise[url];

        let rowCol;
        if (this.fileCache) {
            rowCol = async (row, col) => {
                let offset = ((this.getHgtDataSize() - row - 1) * this.getHgtDataSize() + col) * 2;
                let buffer = await this.fileCache.read(nonZipUrl, offset, 2);
                return buffer.readInt16BE(0);
            };
        } else {
            rowCol = async (row, col) => {
                let offset = ((this.getHgtDataSize() - row - 1) * this.getHgtDataSize() + col) * 2;
                return hgtContent.readInt16BE(offset);
            };
        }

        let avg = (v1, v2, f) => {
            return v1 + (v2 - v1) * f;
        };
        let subLon = lon - Math.floor(lon);
        let subLat = lat - Math.floor(lat);
        let row = subLat * (this.getHgtDataSize() - 1);
        let rowLow = Math.floor(row);
        let rowHi = rowLow + 1;
        let rowFrac = row - rowLow;
        let col = subLon * (this.getHgtDataSize() - 1);
        let colLow = Math.floor(col);
        let colHi = colLow + 1;
        let colFrac = col - colLow;
        let v00 = await rowCol(rowLow, colLow);
        let v10 = await rowCol(rowLow, colHi);
        let v11 = await rowCol(rowHi, colHi);
        let v01 = await rowCol(rowHi, colLow);
        let v1 = avg(v00, v10, colFrac);
        let v2 = avg(v01, v11, colFrac);

        return avg(v1, v2, rowFrac);
    };
}

module.exports = SRTM;