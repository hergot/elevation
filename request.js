let Stream = require('./stream');
let fs = require('fs');
let https = require('https');
let http = require('http');

class Cache {
    constructor() {
        if (new.target === Cache) {
            throw new TypeError("Cannot construct Cache instances directly");
        }
        if (this.read === undefined) {
            throw new TypeError("Must override read method");
        }
        if (this.write === undefined) {
            throw new TypeError("Must override write method");
        }
    }
}

class FileCache extends Cache {
    constructor(folder, id2filename) {
        super();
        this.id2filename = id2filename ? id2filename : (url) => { return url.replace(/[^a-zA-Z0-9]/g, '_'); };
        this.folder = folder;
    }

    async read(id, offset, length) {
        let path = this.folder + '/' + this.id2filename(id);
        let exists = await new Promise((resolve, reject) => { fs.exists(path, (exists) => { resolve(exists); }); });
        if (!exists) {
            return undefined;
        }
        if ((offset === undefined || offset === 0) && length === undefined) {
            return await new Promise((resolve, reject) => {
                fs.readFile(path, (err, data) => {
                    (err) ? reject(err) : resolve(data);
                });
            });
        } else {
            let fd = fs.openSync(path, 'r');
            let result = new Buffer(length);
            let bytesRead = fs.readSync(fd, result, 0, length, offset);
            if (bytesRead !== length) {
                return undefined;
            } else {
                return result;
            }
        }
    }

    async write(id, content) {
        let path = this.folder + '/' + this.id2filename(id);
        if (content instanceof Stream) {
            content.on('data', (data) => {
                fs.appendFileSync(path, data);
            });
        } else {
            return await new Promise((resolve, reject) => {
                fs.writeFile(path, content, (err) => {
                    (err) ? reject(err) : resolve();
                });
            });
        }
    }
};

let cacheWrapper = function(request, cache) {
    return async (url) => {
        let content = await cache.read(url);
        if (content !== undefined) {
            return content;
        }
        content = await request(url);
        await cache.write(url, content);
        return content;
    };
};


let request = async function(url) {
    console.log('Downloading', url);
    let agent = url.match(/^https/) ? https : http;
    let response = await new Promise((resolve, reject) => { agent.get(url, (res) => { resolve(res); })});
    let data = [];
    response.on('data', (chunk) => { data.push(chunk); });
    let promise = new Promise((resolve, reject) => {
        response.on('end', () => {
            resolve(Buffer.concat(data));
        });
    });
    return promise;
};

module.exports = {
    request: request,
    cacheWrapper: cacheWrapper,
    Cache: Cache,
    FileCache: FileCache
};