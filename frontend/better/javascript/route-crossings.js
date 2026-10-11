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
    "gb-southwest": { country: "GB", lon: -4, lat: 51 }
  },
  // pair: the two codes in alphabetical order; ends: the region of each code, in the same order
  corridors: [
    { pair: ["BR", "US"], ends: ["br-northeast", "us-east"] },
    { pair: ["BR", "PT"], ends: ["br-northeast", "pt-southwest"] },
    { pair: ["AO", "BR"], ends: ["ao-north", "br-northeast"] },
    { pair: ["ES", "US"], ends: ["es-north", "us-east"] },
    { pair: ["FR", "US"], ends: ["fr-west", "us-east"] },
    { pair: ["GB", "US"], ends: ["gb-southwest", "us-east"] }
  ]
};
