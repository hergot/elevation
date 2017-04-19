let SRTM = require('./srtm');

class SRTM1 extends SRTM {
    getSrtmUrl() {
        return 'https://dds.cr.usgs.gov/srtm/version2_1/SRTM1/';
    }

    getHgtDataSize() {
        return 3601;
    }
}

module.exports = SRTM1;