import assert from 'assert';
import {config} from './config';
import {parsePokenautsPokemonList, PokenautsInventoryEntry} from './pokenautsInventory';
import {generatePokenautsTeam} from './showdownTeamBuilder';

const sampleInventory = `Your pokémon
\` 1\`　**<:_:721473923308584990> Charizard<:male:1207734081585152101>**　•　Lvl. 63　•　56.99%
\` 2\`　**<:_:721475252911079584> Swinub<:female:1207734084210532483>**　•　Lvl. 2　•　47.31%
\` 3\`　**<:_:721474704002514955> Poliwrath<:female:1207734084210532483>**　•　Lvl. 22　•　55.91%
\`19\`　**<:_:721476020636614739> Snivy<:male:1207734081585152101> ❤️**　•　Lvl. 35　•　79.57%`;

const parsed = parsePokenautsPokemonList(sampleInventory);
assert.strictEqual(parsed.length, 4);
assert.deepStrictEqual(
  parsed.map(entry => [entry.slot, entry.species, entry.level, entry.ivPercent]),
  [
    [1, 'Charizard', 63, 56.99],
    [2, 'Swinub', 2, 47.31],
    [3, 'Poliwrath', 22, 55.91],
    [19, 'Snivy', 35, 79.57],
  ]
);

const now = new Date().toISOString();
const selected = parsed.slice(0, 3).map(
  (entry): PokenautsInventoryEntry => ({
    ...entry,
    sourceMessageId: 'test-message',
    updatedAt: now,
  })
);
const team = generatePokenautsTeam(config, selected);

assert.strictEqual(team.expectedPokemon.length, 3);
assert.strictEqual(team.expectedPokemon[0].species, 'Charizard');
assert.strictEqual(team.expectedPokemon[0].pokenautsLevel, 63);
assert.strictEqual(team.expectedPokemon[0].showdownLevel, 50);
assert.deepStrictEqual(team.expectedPokemon[0].moves, [
  'Earthquake',
  'Flamethrower',
  'Focus Blast',
  'Hurricane',
]);
assert.strictEqual(team.expectedPokemon[0].setSource, 'random-battle');
assert.strictEqual(team.expectedPokemon[1].setSource, 'learnset-fallback');
assert(team.expectedPokemon[1].moves.includes('Earthquake'));
assert(
  team.expectedPokemon[1].moves.some(move =>
    ['Icicle Crash', 'Ice Beam', 'Blizzard'].includes(move)
  )
);
assert(team.expectedPokemon[2].moves.includes('Close Combat'));
assert(team.expectedPokemon[2].moves.includes('Liquidation'));
assert.match(team.importText, /Charizard/);
assert.match(team.importText, /Ability: Blaze/);
assert.match(team.importText, /Level: 50/);
assert.doesNotMatch(team.importText, /Tackle\n- Protect\n- Rest\n- Sleep Talk/);

console.log('Pokenauts flow parser/team tests passed');
