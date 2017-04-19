let SRTM3 = require('./srtm3');
let SRTM1 = require('./srtm1');

let srtm3 = new SRTM3({
   cacheFolder: __dirname + '/cache/srtm3'
});

srtm3.getElevation(14.9198269444, 50.4163577778).then((elevation) => {
  console.log('Elevation', elevation);
});

srtm3.getElevation(17.325482, 49.467729).then((elevation) => {
    console.log('Elevation', elevation);
});

let srtm1 = new SRTM1({
    cacheFolder: __dirname + '/cache/srtm1'
});

srtm1.getElevation( -95.614089,29.599580).then((elevation) => {
    console.log('Elevation', elevation);
});
