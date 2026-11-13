# Regenerating `shared/athens-postcodes.ts`

Data comes from OpenStreetMap (© OpenStreetMap contributors, ODbL) through the Overpass API.

1. Every address with a postal code in the Athens basin, as TSV (`addr.tsv`):
   `[out:csv(::lat,::lon,"addr:postcode","addr:city","addr:suburb","addr:city:en";false;"\t")][timeout:180];nwr["addr:postcode"](37.80,23.55,38.15,23.92);out center;`
2. Named places for labels (`places.tsv`):
   `[out:csv(::lat,::lon,place,name,"name:en";false;"\t")][timeout:90];node["place"~"^(suburb|neighbourhood|quarter|town|village|city)$"](37.78,23.52,38.17,23.95);out;`
3. `node 1-centroids.mjs addr.tsv postcodes.json` (median location per code, how spread out it is)
4. `node 2-labels.mjs postcodes.json places.tsv athens.json` (greater Athens + Piraeus only, labels, municipality)
5. Paste `athens.json` into `shared/athens-postcodes.ts` (rename the municipality "Athina" to "Athens").
