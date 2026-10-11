/* exported LibreSpeedRouteCrossings */
/**
 * Places where a route crosses a sea by submarine cable, by pair of countries (see frontend/better/map/README.md for the
 * cables and the sources of each line). The ends are regions in whole degrees, on purpose not the towns where the cables land.
 */
var LibreSpeedRouteCrossings = {
  v: 1,
  regions: {
    "us-east": { country: "US", lon: -76, lat: 36 },
    "br-northeast": { country: "BR", lon: -39, lat: -5 },
    "pt-southwest": { country: "PT", lon: -8, lat: 38 },
    "ao-north": { country: "AO", lon: 14, lat: -9 },
    "es-north": { country: "ES", lon: -3, lat: 43 },
    "fr-west": { country: "FR", lon: -2, lat: 47 },
    "gb-southwest": { country: "GB", lon: -4, lat: 51 },
    "us-west": { country: "US", lon: -123, lat: 41 },
    "jp-east": { country: "JP", lon: 140, lat: 35 },
    "kr-southeast": { country: "KR", lon: 129, lat: 35 },
    "tw-north": { country: "TW", lon: 122, lat: 25 },
    "cn-east": { country: "CN", lon: 121, lat: 31 },
    hk: { country: "HK", lon: 114, lat: 22 },
    "ph-luzon": { country: "PH", lon: 122, lat: 14 },
    sg: { country: "SG", lon: 104, lat: 1 },
    "au-east": { country: "AU", lon: 151, lat: -34 },
    "nz-north": { country: "NZ", lon: 175, lat: -37 },
    "au-west": { country: "AU", lon: 116, lat: -32 },
    "in-east": { country: "IN", lon: 80, lat: 13 }
  },
  // pair: the two codes in alphabetical order; ends: the region of each code, in the same order
  corridors: [
    { pair: ["BR", "US"], ends: ["br-northeast", "us-east"] },
    { pair: ["BR", "PT"], ends: ["br-northeast", "pt-southwest"] },
    { pair: ["AO", "BR"], ends: ["ao-north", "br-northeast"] },
    { pair: ["ES", "US"], ends: ["es-north", "us-east"] },
    { pair: ["FR", "US"], ends: ["fr-west", "us-east"] },
    { pair: ["GB", "US"], ends: ["gb-southwest", "us-east"] },
    // The Pacific: all of them go round the date line in the map
    { pair: ["JP", "US"], ends: ["jp-east", "us-west"] },
    { pair: ["KR", "US"], ends: ["kr-southeast", "us-west"] },
    { pair: ["TW", "US"], ends: ["tw-north", "us-west"] },
    { pair: ["CN", "US"], ends: ["cn-east", "us-west"] },
    { pair: ["HK", "US"], ends: ["hk", "us-west"] },
    { pair: ["PH", "US"], ends: ["ph-luzon", "us-west"] },
    { pair: ["SG", "US"], ends: ["sg", "us-west"] },
    { pair: ["AU", "US"], ends: ["au-east", "us-west"] },
    { pair: ["NZ", "US"], ends: ["nz-north", "us-west"] },
    // South East Asia and the Indian Ocean
    { pair: ["AU", "SG"], ends: ["au-west", "sg"] },
    { pair: ["IN", "SG"], ends: ["in-east", "sg"] },
    { pair: ["JP", "SG"], ends: ["jp-east", "sg"] }
  ]
};
