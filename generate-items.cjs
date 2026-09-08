/*
 * Bundles the TypeScript item constants in src/constants/ into
 * a plain JSON file the CommonJS server can require.
 *
 *   node generate-items.cjs   ->   items.data.json
 *
 * Re-run whenever src/constants/*.ts changes. The output is
 * committed so `node server.cjs` works without a build step.
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const os = require('os');

const OUT = path.resolve('items.data.json');

const tmp = path.join(os.tmpdir(), `gamma-items-${Date.now()}.cjs`);

esbuild.buildSync({
  entryPoints: [path.resolve('src/constants/index.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: tmp,
});

const constants = require(tmp);

fs.unlinkSync(tmp);

/*
 * Group into the three roulette categories. Weapons keep their
 * `ammo` field (needed for the WEAPON|id|ammo command); armor and
 * helmets only need id + name for display.
 */
const weapons = [
  ...constants.pistols,
  ...constants.shotguns,
  ...constants.smgs,
  ...constants.rifles,
  ...constants.snipers,
].map((item) => ({ id: item.id, name: item.name, ammo: item.ammo || '' }));

const helmets = [
  ...constants.helmetsField,
  ...constants.helmetsLight,
  ...constants.helmetsMedium,
  ...constants.helmetsHeavyExo,
].map((item) => ({ id: item.id, name: item.name }));

const armor = [
  ...constants.outfitsField,
  ...constants.outfitsLight,
  ...constants.outfitsMedium,
  ...constants.outfitsHeavy,
  ...constants.outfitsExo,
].map((item) => ({ id: item.id, name: item.name }));

const data = { weapons, helmets, armor };

fs.writeFileSync(OUT, JSON.stringify(data, null, 2), 'utf8');

console.log(
  `items.data.json written: ${weapons.length} weapons, ${helmets.length} helmets, ${armor.length} armor`,
);
