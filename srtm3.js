let SRTM = require('./srtm');

class SRTM3 extends SRTM {
    getSrtmUrl() {
        return 'https://dds.cr.usgs.gov/srtm/version2_1/SRTM3/';
    }

    getHgtDataSize() {
        return 1201;
    }
}

module.exports = SRTM3;