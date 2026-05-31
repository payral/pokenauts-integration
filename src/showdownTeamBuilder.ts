import {createRequire} from 'module';
import path from 'path';
import {AppConfig} from './config';
import {PokenautsInventoryEntry} from './pokenautsInventory';

const requireFromHere = createRequire(__filename);
const FALLBACK_STATUS_MOVES = [
  'Shell Smash',
  'Dragon Dance',
  'Swords Dance',
  'Nasty Plot',
  'Calm Mind',
  'Bulk Up',
  'Coil',
  'Stealth Rock',
  'Spikes',
  'Toxic Spikes',
  'Thunder Wave',
  'Will-O-Wisp',
  'Recover',
  'Roost',
  'Synthesis',
  'Leech Seed',
  'Protect',
];

interface ShowdownSpecies {
  exists: boolean;
  id: string;
  name: string;
  types: string[];
  baseStats: {
    atk: number;
    spa: number;
  };
  abilities: Record<string, string>;
}

interface ShowdownMove {
  exists: boolean;
  id: string;
  name: string;
  type: string;
  category: 'Physical' | 'Special' | 'Status';
  basePower: number;
  accuracy: number | true;
  priority: number;
  isNonstandard?: string | null;
  flags?: Record<string, 1 | true>;
}

interface ShowdownDex {
  species: {
    get: (name: string) => ShowdownSpecies;
    getMovePool: (id: string, isNatDex?: boolean) => Set<string>;
  };
  moves: {
    get: (name: string) => ShowdownMove;
  };
}

interface ShowdownSim {
  Dex: ShowdownDex & {
    mod: (modid: string) => ShowdownDex;
  };
  Teams: {
    import: (team: string) => unknown;
    pack: (team: unknown) => string;
  };
  TeamValidator: new (format: string) => {
    validateTeam: (team: unknown) => string[] | null;
  };
}

export interface GeneratedPokenautsPokemon {
  slot: number;
  species: string;
  pokenautsLevel: number;
  showdownLevel: number;
  ability: string;
  ivPercent: number;
  moves: string[];
  teraType?: string;
  setSource: 'random-battle' | 'learnset-fallback';
}

export interface GeneratedPokenautsTeam {
  importText: string;
  expectedPokemon: GeneratedPokenautsPokemon[];
}

export function generatePokenautsTeam(
  config: AppConfig,
  entries: PokenautsInventoryEntry[]
): GeneratedPokenautsTeam {
  if (entries.length !== 3) {
    throw new Error('Exactly 3 Pokenauts Pokemon are required');
  }

  const sim = loadShowdownSim(config.showdownRoot);
  const randomSets = loadRandomBattleSets(config.showdownRoot);
  const expectedPokemon = entries.map(entry => buildPokemonSet(sim, randomSets, entry));
  const importText = expectedPokemon.map(formatPokemonSet).join('\n\n');
  const validationErrors = new sim.TeamValidator(config.showdownPokenautsFormat).validateTeam(
    sim.Teams.import(importText)
  );

  if (validationErrors?.length) {
    throw new Error(`Generated Showdown team was rejected: ${validationErrors.join(' ')}`);
  }

  return {importText, expectedPokemon};
}

export function packTeamImport(config: AppConfig, importText: string): string {
  const sim = loadShowdownSim(config.showdownRoot);
  return sim.Teams.pack(sim.Teams.import(importText));
}

function buildPokemonSet(
  sim: ShowdownSim,
  randomSets: RandomBattleSetData,
  entry: PokenautsInventoryEntry
): GeneratedPokenautsPokemon {
  const dex = sim.Dex.mod('gen9');
  const species = dex.species.get(entry.species);
  if (!species.exists) {
    throw new Error(`Showdown does not recognize species "${entry.species}"`);
  }

  const randomSet = selectRandomBattleSet(randomSets, species);
  const ability =
    randomSet?.abilities.find(candidate => Object.values(species.abilities || {}).includes(candidate)) ||
    Object.values(species.abilities || {})[0];
  if (!ability) {
    throw new Error(`Showdown did not provide an ability for "${species.name}"`);
  }

  const moves = randomSet
    ? chooseRandomBattleMoves(randomSet)
    : chooseFallbackMoves(dex, species);

  return {
    slot: entry.slot,
    species: species.name,
    pokenautsLevel: entry.level,
    showdownLevel: Math.min(entry.level, 50),
    ability,
    ivPercent: entry.ivPercent,
    moves,
    teraType: randomSet?.teraTypes[0],
    setSource: randomSet ? 'random-battle' : 'learnset-fallback',
  };
}

function formatPokemonSet(pokemon: GeneratedPokenautsPokemon): string {
  return [
    `${pokemon.species}`,
    `Ability: ${pokemon.ability}`,
    pokemon.teraType ? `Tera Type: ${pokemon.teraType}` : undefined,
    `Level: ${pokemon.showdownLevel}`,
    'EVs: 1 HP',
    ...pokemon.moves.map(move => `- ${move}`),
  ]
    .filter(Boolean)
    .join('\n');
}

function loadShowdownSim(showdownRoot: string): ShowdownSim {
  const simPath = path.join(path.resolve(process.cwd(), showdownRoot), 'dist', 'sim');
  return requireFromHere(simPath) as ShowdownSim;
}

interface RandomBattlePokemonData {
  sets?: RandomBattleSet[];
}

interface RandomBattleSet {
  role?: string;
  movepool: string[];
  abilities: string[];
  teraTypes: string[];
}

type RandomBattleSetData = Record<string, RandomBattlePokemonData>;

function loadRandomBattleSets(showdownRoot: string): RandomBattleSetData {
  const setsPath = path.join(
    path.resolve(process.cwd(), showdownRoot),
    'data',
    'random-battles',
    'gen9',
    'sets.json'
  );
  return requireFromHere(setsPath) as RandomBattleSetData;
}

function selectRandomBattleSet(
  randomSets: RandomBattleSetData,
  species: ShowdownSpecies
): RandomBattleSet | undefined {
  const speciesSets = randomSets[species.id]?.sets;
  return speciesSets?.[0];
}

function chooseRandomBattleMoves(randomSet: RandomBattleSet): string[] {
  const moves = uniqueMoves(randomSet.movepool).filter(move => move !== 'Tera Blast');
  const selectedMoves = moves.slice(0, 4);
  if (selectedMoves.length === 4) return selectedMoves;

  return uniqueMoves([...selectedMoves, ...randomSet.movepool]).slice(0, 4);
}

function chooseFallbackMoves(dex: ShowdownDex, species: ShowdownSpecies): string[] {
  const movePool = [...dex.species.getMovePool(species.id)];
  const damagingMoves = movePool
    .map(moveId => dex.moves.get(moveId))
    .filter(move => isUsefulDamagingMove(move))
    .sort((a, b) => scoreMove(b, species) - scoreMove(a, species))
    .map(move => move.name);
  const statusMoves = FALLBACK_STATUS_MOVES.filter(moveName =>
    movePool.includes(toId(moveName))
  );

  return uniqueMoves([...damagingMoves.slice(0, 4), ...statusMoves]).slice(0, 4);
}

function isUsefulDamagingMove(move: ShowdownMove): boolean {
  return (
    move.exists &&
    move.category !== 'Status' &&
    move.basePower > 0 &&
    !move.isNonstandard &&
    move.accuracy !== true &&
    move.accuracy >= 70 &&
    !['Explosion', 'Self-Destruct', 'Final Gambit'].includes(move.name)
  );
}

function scoreMove(move: ShowdownMove, species: ShowdownSpecies): number {
  const preferredCategory = species.baseStats.atk >= species.baseStats.spa ? 'Physical' : 'Special';
  const stabBonus = species.types.includes(move.type) ? 70 : 0;
  const categoryBonus = move.category === preferredCategory ? 20 : 0;
  const priorityBonus = move.priority > 0 ? 10 : 0;
  const accuracyPenalty = typeof move.accuracy === 'number' ? Math.max(0, 100 - move.accuracy) : 0;

  return move.basePower + stabBonus + categoryBonus + priorityBonus - accuracyPenalty;
}

function uniqueMoves(moves: string[]): string[] {
  const seen = new Set<string>();
  return moves.filter(move => {
    const id = toId(move);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function toId(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
