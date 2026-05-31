// Packed Showdown team format:
// name|species|item|ability|moves|nature|evs|gender|ivs|shiny|level|happiness
// Multiple Pokemon are separated with `]`.
// Replace this with a team exported from Showdown and packed via the server's
// `pokemon-showdown pack-team` command if you need a richer test team later.
export const TEST_TEAM_A_PACKED =
  'Pika|Pikachu|lightball|static|thunderbolt,irontail,quickattack,voltswitch|Jolly|0,252,0,0,4,252||31,31,31,31,31,31|||]Zard|Charizard|heavydutyboots|blaze|flamethrower,airslash,dragonpulse,willowisp|Timid|0,0,0,252,4,252||31,31,31,31,31,31|||';

export const TEST_TEAM_IMPORT_TEXT = `Pika (Pikachu) @ Light Ball
Ability: Static
Tera Type: Electric
EVs: 4 HP / 252 Atk / 252 Spe
Jolly Nature
- Thunderbolt
- Iron Tail
- Quick Attack
- Volt Switch

Zard (Charizard) @ Heavy-Duty Boots
Ability: Blaze
Tera Type: Fire
EVs: 4 HP / 252 SpA / 252 Spe
Timid Nature
- Flamethrower
- Air Slash
- Dragon Pulse
- Will-O-Wisp`;

export const TEST_TEAM_ALLOWED_SPECIES = ['Pikachu', 'Charizard'];

export interface HumanMatchTeamAssignment {
  label: string;
  importText: string;
  expectedSpecies: string[];
}

export const HUMAN_PLAYER_A_TEAM: HumanMatchTeamAssignment = {
  label: 'Pokenauts Test Team A',
  importText: TEST_TEAM_IMPORT_TEXT,
  expectedSpecies: TEST_TEAM_ALLOWED_SPECIES,
};

export const HUMAN_PLAYER_B_TEAM: HumanMatchTeamAssignment = {
  label: 'Pokenauts Test Team B',
  importText: `Blastoise @ Leftovers
Ability: Torrent
Tera Type: Water
EVs: 252 HP / 252 Def / 4 SpA
Bold Nature
- Surf
- Ice Beam
- Rapid Spin
- Protect

Venusaur @ Black Sludge
Ability: Overgrow
Tera Type: Grass
EVs: 252 HP / 4 SpA / 252 SpD
Calm Nature
- Giga Drain
- Sludge Bomb
- Sleep Powder
- Leech Seed`,
  expectedSpecies: ['Blastoise', 'Venusaur'],
};
