# Map of the route page

`route-better.html` can show the countries a route goes through on a map. The shapes of the countries are in
`../vendor/world-110m.js`: a generated file (about 90 KB, about 25 KB with gzip) that the page asks for only when the map is
chosen. It is a `.js` file and not a `.json` one because the Apache of the Docker image compresses JavaScript but not JSON.

The file is made from the countries of [Natural Earth](https://www.naturalearthdata.com/) 5.1.2 (public domain, see
`../vendor/world-110m.LICENSE`). The page asks nothing of other sites: the data is here.

## Regenerate it

Download the two files in a new, empty folder outside the repository, and check them. The script checks the `sha256` too and
stops when they are not these:

```
https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_admin_0_countries.geojson
  sha256 6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f
https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson
  sha256 3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb
```

```
node frontend/better/map/build-world.js <ne_110m_admin_0_countries.geojson> <ne_50m_admin_0_countries.geojson>
```

The downloaded files are only data for the script: nothing of them runs in the page. Running it twice gives the same file.

## What is in the file

`LibreSpeedWorld = { v, width: 360, height: 142, shapes, centers, points }` in an equirectangular projection (x = longitude + 180,
y = 84 - latitude, Antarctica is not drawn):

- `shapes`: `[code, path]` for each country of the 110m file. `code` is the ISO 3166-1 alpha-2 code (the `ISO_A2_EH` field, which
  has FR, NO and TW right) or `""` when there is none.
- `centers[code] = [x, y, x0, y0, x1, y1]`: a point well inside the largest polygon of the country, and its box.
- `points[code] = [x, y]`: for the small countries that the 110m file does not draw (the 50m file has them) and for a few
  territories (`EXTRA` in the script) that Natural Earth draws inside another country. The page draws a spot for them.

The map is of countries: the address of a router is placed in a country by a database, often where the operator has its head
office, so there is no pin in a city.

## Sea crossings (`frontend/better/javascript/route-crossings.js`)

Where a route crosses a sea by submarine cable, the map draws two small marks with no number: the regions where the cables of
that sea land. The table is by pair of countries (a corridor), not by network: the networks that carry the traffic are global and
own more than one cable. A crossing is drawn only when the time rose at least what light in fiber needs to cross that sea.
A line is added only with a source, and a region is in whole degrees, never a town. Verified with the public API of the Submarine Cable
Map (TeleGeography), `https://www.submarinecablemap.com/api/v3/cable/<id>.json`: the Atlantic on 2026-10-10, the Pacific, South East Asia and the
Indian Ocean (IN-SG) on 2026-10-11. The method: cables that are not planned, with the two countries among their landings (Hong Kong
landings are labelled "China" by the source and are counted as HK, the country the map uses). A corridor ends in the region of each
side; all the ones of the Pacific go round the date line in the map (the curve is drawn in two parts, one to each edge).

| Pair | Regions | Cables (landings) | Source |
|---|---|---|---|
| BR-US | br-northeast / us-east | Seabras-1 (Wall Township NJ; Praia Grande) | https://www.submarinecablemap.com/api/v3/cable/seabras-1.json |
| BR-US | br-northeast / us-east | GlobeNet (Tuckerton NJ, Boca Raton FL; Fortaleza, Rio) | https://www.submarinecablemap.com/api/v3/cable/globenet.json |
| BR-US | br-northeast / us-east | Monet (Boca Raton FL; Fortaleza, Santos) | https://www.submarinecablemap.com/api/v3/cable/monet.json |
| BR-US | br-northeast / us-east | BRUSA (Virginia Beach VA; Fortaleza, Rio) | https://www.submarinecablemap.com/api/v3/cable/brusa.json |
| BR-US | br-northeast / us-east | SAm-1 (Boca Raton FL; Fortaleza, Salvador, Rio, Santos) | https://www.submarinecablemap.com/api/v3/cable/south-america-1-sam-1.json |
| BR-US | br-northeast / us-east | Firmina (Myrtle Beach SC; Praia Grande) | https://www.submarinecablemap.com/api/v3/cable/firmina.json |
| BR-PT | br-northeast / pt-southwest | EllaLink (Fortaleza; Sines) | https://www.submarinecablemap.com/api/v3/cable/ellalink.json |
| AO-BR | ao-north / br-northeast | SACS (Sangano; Fortaleza) | https://www.submarinecablemap.com/api/v3/cable/south-atlantic-cable-system-sacs.json |
| ES-US | es-north / us-east | MAREA (Bilbao; Virginia Beach VA) | https://www.submarinecablemap.com/api/v3/cable/marea.json |
| ES-US | es-north / us-east | Grace Hopper (Bilbao; Bellport NY) | https://www.submarinecablemap.com/api/v3/cable/grace-hopper.json |
| FR-US | fr-west / us-east | Dunant (Saint-Hilaire-de-Riez; Virginia Beach VA) | https://www.submarinecablemap.com/api/v3/cable/dunant.json |
| GB-US | gb-southwest / us-east | Grace Hopper (Bude; Bellport NY) | https://www.submarinecablemap.com/api/v3/cable/grace-hopper.json |
| JP-US | jp-east / us-west | FASTER (Chikura, Shima; Bandon, OR) | https://www.submarinecablemap.com/api/v3/cable/faster.json |
| JP-US | jp-east / us-west | JUPITER (Maruyama, Shima; Cloverdale, OR, Hermosa Beach, CA) | https://www.submarinecablemap.com/api/v3/cable/jupiter.json |
| JP-US | jp-east / us-west | JUNO (Minamiboso, Shima; Grover Beach, CA) | https://www.submarinecablemap.com/api/v3/cable/juno.json |
| JP-US | jp-east / us-west | New Cross Pacific (NCP) Cable System (Maruyama; Pacific City, OR) | https://www.submarinecablemap.com/api/v3/cable/new-cross-pacific-ncp-cable-system.json |
| JP-US | jp-east / us-west | Pacific Crossing-1 (PC-1) (Ajigaura, Shima; Grover Beach, CA, Harbour Pointe, WA) | https://www.submarinecablemap.com/api/v3/cable/pacific-crossing-1-pc-1.json |
| JP-US | jp-east / us-west | Tata TGN-Pacific (Emi, Toyohashi; Hillsboro, OR, Los Angeles, CA) | https://www.submarinecablemap.com/api/v3/cable/tata-tgn-pacific.json |
| JP-US | jp-east / us-west | Trans-Pacific Express (TPE) Cable System (Maruyama; Nedonna Beach, OR) | https://www.submarinecablemap.com/api/v3/cable/trans-pacific-express-tpe-cable-system.json |
| JP-US | jp-east / us-west | Unity (Chikura; Redondo Beach, CA) | https://www.submarinecablemap.com/api/v3/cable/unity.json |
| KR-US | kr-southeast / us-west | Trans-Pacific Express (TPE) Cable System (Geoje; Nedonna Beach, OR) | https://www.submarinecablemap.com/api/v3/cable/trans-pacific-express-tpe-cable-system.json |
| KR-US | kr-southeast / us-west | New Cross Pacific (NCP) Cable System (Busan; Pacific City, OR) | https://www.submarinecablemap.com/api/v3/cable/new-cross-pacific-ncp-cable-system.json |
| TW-US | tw-north / us-west | FASTER (Tanshui; Bandon, OR) | https://www.submarinecablemap.com/api/v3/cable/faster.json |
| TW-US | tw-north / us-west | Pacific Light Cable Network (PLCN) (Toucheng; El Segundo, CA) | https://www.submarinecablemap.com/api/v3/cable/pacific-light-cable-network-plcn.json |
| TW-US | tw-north / us-west | New Cross Pacific (NCP) Cable System (Toucheng; Pacific City, OR) | https://www.submarinecablemap.com/api/v3/cable/new-cross-pacific-ncp-cable-system.json |
| TW-US | tw-north / us-west | Trans-Pacific Express (TPE) Cable System (Tanshui; Nedonna Beach, OR) | https://www.submarinecablemap.com/api/v3/cable/trans-pacific-express-tpe-cable-system.json |
| TW-US | tw-north / us-west | TPU (Dawu; Eureka, CA) | https://www.submarinecablemap.com/api/v3/cable/tpu.json |
| CN-US | cn-east / us-west | Trans-Pacific Express (TPE) Cable System (Chongming, Qingdao; Nedonna Beach, OR) | https://www.submarinecablemap.com/api/v3/cable/trans-pacific-express-tpe-cable-system.json |
| CN-US | cn-east / us-west | New Cross Pacific (NCP) Cable System (Chongming, Lingang, Nanhui; Pacific City, OR) | https://www.submarinecablemap.com/api/v3/cable/new-cross-pacific-ncp-cable-system.json |
| HK-US | hk / us-west | Asia-America Gateway (AAG) Cable System (Lantau Island; Keawaula, HI, Morro Bay, CA) | https://www.submarinecablemap.com/api/v3/cable/asia-america-gateway-aag-cable-system.json |
| PH-US | ph-luzon / us-west | JUPITER (Daet; Cloverdale, OR, Hermosa Beach, CA) | https://www.submarinecablemap.com/api/v3/cable/jupiter.json |
| PH-US | ph-luzon / us-west | SEA-US (Davao; Hermosa Beach, CA, Makaha, HI) | https://www.submarinecablemap.com/api/v3/cable/sea-us.json |
| PH-US | ph-luzon / us-west | Pacific Light Cable Network (PLCN) (Baler; El Segundo, CA) | https://www.submarinecablemap.com/api/v3/cable/pacific-light-cable-network-plcn.json |
| PH-US | ph-luzon / us-west | Asia-America Gateway (AAG) Cable System (La Union; Keawaula, HI, Morro Bay, CA) | https://www.submarinecablemap.com/api/v3/cable/asia-america-gateway-aag-cable-system.json |
| PH-US | ph-luzon / us-west | Bifrost (Davao; Grover Beach, CA, Winema, OR) | https://www.submarinecablemap.com/api/v3/cable/bifrost.json |
| PH-US | ph-luzon / us-west | TPU (Claveria; Eureka, CA) | https://www.submarinecablemap.com/api/v3/cable/tpu.json |
| SG-US | sg / us-west | Asia-America Gateway (AAG) Cable System (Changi North; Keawaula, HI, Morro Bay, CA) | https://www.submarinecablemap.com/api/v3/cable/asia-america-gateway-aag-cable-system.json |
| SG-US | sg / us-west | Bifrost (Tuas; Grover Beach, CA, Winema, OR) | https://www.submarinecablemap.com/api/v3/cable/bifrost.json |
| SG-US | sg / us-west | Echo (Changi North; Eureka, CA) | https://www.submarinecablemap.com/api/v3/cable/echo.json |
| AU-US | au-east / us-west | Southern Cross Cable Network (SCCN) (Alexandria, Brookvale; Hillsboro, OR, Kahe Point, HI, Morro Bay, CA, Spencer Beach, HI) | https://www.submarinecablemap.com/api/v3/cable/southern-cross-cable-network-sccn.json |
| AU-US | au-east / us-west | Southern Cross NEXT (Alexandria; Hermosa Beach, CA) | https://www.submarinecablemap.com/api/v3/cable/southern-cross-next.json |
| AU-US | au-east / us-west | Hawaiki (Sydney; Hillsboro, OR, Kapolei, HI) | https://www.submarinecablemap.com/api/v3/cable/hawaiki.json |
| NZ-US | nz-north / us-west | Southern Cross Cable Network (SCCN) (Takapuna, Whenuapai; Hillsboro, OR, Kahe Point, HI, Morro Bay, CA, Spencer Beach, HI) | https://www.submarinecablemap.com/api/v3/cable/southern-cross-cable-network-sccn.json |
| NZ-US | nz-north / us-west | Southern Cross NEXT (Takapuna; Hermosa Beach, CA) | https://www.submarinecablemap.com/api/v3/cable/southern-cross-next.json |
| NZ-US | nz-north / us-west | Hawaiki (Mangawhai; Hillsboro, OR, Kapolei, HI) | https://www.submarinecablemap.com/api/v3/cable/hawaiki.json |
| AU-SG | au-west / sg | Australia-Singapore Cable (ASC) (Perth; Tanah Merah) | https://www.submarinecablemap.com/api/v3/cable/australia-singapore-cable-asc.json |
| AU-SG | au-west / sg | INDIGO-West (Perth; Tuas) | https://www.submarinecablemap.com/api/v3/cable/indigo-west.json |
| IN-SG | in-east / sg | i2i Cable Network (i2icn) (Chennai; Tuas) | https://www.submarinecablemap.com/api/v3/cable/i2i-cable-network-i2icn.json |
| IN-SG | in-east / sg | Tata TGN-Tata Indicom (Chennai; Changi North) | https://www.submarinecablemap.com/api/v3/cable/tata-tgn-tata-indicom.json |
| IN-SG | in-east / sg | SeaMeWe-4 (Chennai, Mumbai; Tuas) | https://www.submarinecablemap.com/api/v3/cable/seamewe-4.json |
| IN-SG | in-east / sg | MIST (Chennai, Mumbai; Tuas) | https://www.submarinecablemap.com/api/v3/cable/mist.json |
| IN-SG | in-east / sg | India Asia Xpress (IAX) (Chennai, Digha, Machilipatnam, Mumbai; Tuas) | https://www.submarinecablemap.com/api/v3/cable/india-asia-xpress-iax.json |
| JP-SG | jp-east / sg | Southeast Asia-Japan Cable (SJC) (Chikura; Tuas) | https://www.submarinecablemap.com/api/v3/cable/southeast-asia-japan-cable-sjc.json |
| JP-SG | jp-east / sg | Southeast Asia-Japan Cable 2 (SJC2) (Chikura, Shima; Changi South) | https://www.submarinecablemap.com/api/v3/cable/southeast-asia-japan-cable-2-sjc2.json |
| JP-SG | jp-east / sg | Asia Pacific Gateway (APG) (Maruyama, Shima; Changi South) | https://www.submarinecablemap.com/api/v3/cable/asia-pacific-gateway-apg.json |
| JP-SG | jp-east / sg | Asia Direct Cable (ADC) (Maruyama; Tuas) | https://www.submarinecablemap.com/api/v3/cable/asia-direct-cable-adc.json |
| JP-SG | jp-east / sg | Apricot (Minamiboso; Tuas) | https://www.submarinecablemap.com/api/v3/cable/apricot.json |
| JP-SG | jp-east / sg | EAC-C2C (Ajigaura, Chikura, Shima; Changi North, Changi South) | https://www.submarinecablemap.com/api/v3/cable/eac-c2c.json |
| JP-SG | jp-east / sg | APCN-2 (Chikura, Kitaibaraki; Katong) | https://www.submarinecablemap.com/api/v3/cable/apcn-2.json |
| JP-SG | jp-east / sg | Asia Submarine-cable Express (ASE)/Cahaya Malaysia (Komesu, Maruyama; Changi South) | https://www.submarinecablemap.com/api/v3/cable/asia-submarine-cable-express-asecahaya-malaysia.json |

The US end of the Pacific is one region (-123, 41): the cables land from Washington to Los Angeles (lat 34 to 48), and that is within 8 degrees of
all of them. Cables that go by Guam or Hawaii (AAG, SEA-US, Bifrost, Echo, Southern Cross, Hawaiki) are counted by the countries they land
in; Hawaii is the US. A corridor is used only when the time rose at least what light in fiber needs for its distance, and the table does not
have a corridor whose least rise is under 20 ms (the last mile of the visitor alone could make it).

The rise is only a lower bound. For SG-US and HK-US the time of a route by the Pacific and the one of a route by Europe (Marseille, then the Atlantic) cannot be told apart, and the US end of a corridor is one region on the west coast: when a route goes by the other way, the map draws a Pacific cable that the route may not have used, so read these two as likely and not as sure. The region ph-luzon is the Luzon end (4 of the 6 cables land there: Daet, Baler, La Union, Claveria); SEA-US and Bifrost land at Davao, in Mindanao, about 7 degrees to the south.

The BR end is the northeast coast because 4 of the 6 US-BR systems land at Fortaleza. Left out: pairs with a land route (AR-BR), the short seas (AE-IN, IN-OM, AU-NZ and the like: under 20 ms), the ones with no demand yet (HK-SG, which is 20 ms and at the edge of the rule, IN-KE, AE-KE, DJ-IN, IN-ZA, AU-OM), and the Europe to Asia and Europe to West Africa pairs (FR-IN, GB-IN, FR-SG, PT-NG, PT-ZA: a straight curve between them crosses land, they need points at sea),
and US to NL or DE (the traffic often crosses into GB or FR and goes on by land). Seabras-1 at Fortaleza is not confirmed by the
Submarine Cable Map (only Praia Grande), so it is not counted. The state of the ARBR cable (same operator as AS13786) was not verified.
