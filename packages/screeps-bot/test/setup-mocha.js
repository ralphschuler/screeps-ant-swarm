//inject mocha globally to allow custom interface refer without direct import - bypass bundle issue
// Provide minimal lodash-like utilities for tests without depending on lodash
// Note: _.clone() is a SHALLOW clone (same as lodash's default behavior, not _.cloneDeep())
global._ = {
  clone: function(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.slice();
    }
    return Object.assign({}, obj);
  }
};

// Mock Game object early - required by the custom traffic management module
// that access Game globals at module load time
global.Game = {
  creeps: {},
  rooms: {},
  spawns: {},
  time: 12345,
  cpu: {
    getUsed: () => 0,
    limit: 20,
    tickLimit: 500,
    bucket: 10000,
    shardLimits: {},
    unlocked: false,
    unlockedTime: 0
  },
  powerCreeps: {},
  map: {
    getRoomLinearDistance: () => 1,
    getWorldSize: () => 252,
    describeExits: () => ({}),
    findRoute: () => [],
    findExit: () => null,
    getRoomTerrain: () => ({
      get: () => 0,
      getRawBuffer: () => new Uint8Array(2500)
    }),
    getRoomStatus: () => ({ status: 'normal', timestamp: null }),
    visual: {}
  }
};

// Mock Memory early as well
global.Memory = {
  creeps: {},
  rooms: {},
  spawns: {},
  flags: {},
  powerCreeps: {}
};

global.mocha = require('mocha');
global.chai = require('chai');
global.sinon = require('sinon');
global.chai.use(require('sinon-chai'));

// Override ts-node compiler options
process.env.TS_NODE_PROJECT = 'tsconfig.test.json';

// Mock Screeps constants
global.STRUCTURE_SPAWN = 'spawn';
global.STRUCTURE_EXTENSION = 'extension';
global.STRUCTURE_ROAD = 'road';
global.STRUCTURE_WALL = 'constructedWall';
global.STRUCTURE_RAMPART = 'rampart';
global.STRUCTURE_KEEPER_LAIR = 'keeperLair';
global.STRUCTURE_PORTAL = 'portal';
global.STRUCTURE_CONTROLLER = 'controller';
global.STRUCTURE_LINK = 'link';
global.STRUCTURE_STORAGE = 'storage';
global.STRUCTURE_TOWER = 'tower';
global.STRUCTURE_OBSERVER = 'observer';
global.STRUCTURE_POWER_BANK = 'powerBank';
global.STRUCTURE_POWER_SPAWN = 'powerSpawn';
global.STRUCTURE_EXTRACTOR = 'extractor';
global.STRUCTURE_LAB = 'lab';
global.STRUCTURE_TERMINAL = 'terminal';
global.STRUCTURE_CONTAINER = 'container';
global.STRUCTURE_NUKER = 'nuker';
global.STRUCTURE_FACTORY = 'factory';
global.STRUCTURE_INVADER_CORE = 'invaderCore';

// Mock Screeps result codes
global.OK = 0;
global.ERR_NOT_OWNER = -1;
global.ERR_NO_PATH = -2;
global.ERR_NAME_EXISTS = -3;
global.ERR_BUSY = -4;
global.ERR_NOT_FOUND = -5;
global.ERR_NOT_ENOUGH_ENERGY = -6;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.ERR_INVALID_TARGET = -7;
global.ERR_FULL = -8;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_INVALID_ARGS = -10;
global.ERR_TIRED = -11;
global.ERR_NO_BODYPART = -12;
global.ERR_NOT_ENOUGH_EXTENSIONS = -6;
global.ERR_RCL_NOT_ENOUGH = -14;
global.ERR_GCL_NOT_ENOUGH = -15;

// Mock FIND constants
global.FIND_EXIT_TOP = 1;
global.FIND_EXIT_RIGHT = 3;
global.FIND_EXIT_BOTTOM = 5;
global.FIND_EXIT_LEFT = 7;
global.FIND_EXIT = 10;
global.FIND_CREEPS = 101;
global.FIND_MY_CREEPS = 102;
global.FIND_HOSTILE_CREEPS = 103;
global.FIND_SOURCES_ACTIVE = 104;
global.FIND_SOURCES = 105;
global.FIND_DROPPED_RESOURCES = 106;
global.FIND_STRUCTURES = 107;
global.FIND_MY_STRUCTURES = 108;
global.FIND_HOSTILE_STRUCTURES = 109;
global.FIND_FLAGS = 110;
global.FIND_CONSTRUCTION_SITES = 111;
global.FIND_MY_SPAWNS = 112;
global.FIND_HOSTILE_SPAWNS = 113;
global.FIND_MY_CONSTRUCTION_SITES = 114;
global.FIND_HOSTILE_CONSTRUCTION_SITES = 115;
global.FIND_MINERALS = 116;
global.FIND_NUKES = 117;
global.FIND_TOMBSTONES = 118;
global.FIND_POWER_CREEPS = 119;
global.FIND_MY_POWER_CREEPS = 120;
global.FIND_HOSTILE_POWER_CREEPS = 121;
global.FIND_DEPOSITS = 122;
global.FIND_RUINS = 123;

// Mock LOOK constants
global.LOOK_CREEPS = 'creep';
global.LOOK_ENERGY = 'energy';
global.LOOK_RESOURCES = 'resource';
global.LOOK_SOURCES = 'source';
global.LOOK_MINERALS = 'mineral';
global.LOOK_DEPOSITS = 'deposit';
global.LOOK_STRUCTURES = 'structure';
global.LOOK_FLAGS = 'flag';
global.LOOK_CONSTRUCTION_SITES = 'constructionSite';
global.LOOK_NUKES = 'nuke';
global.LOOK_TERRAIN = 'terrain';
global.LOOK_TOMBSTONES = 'tombstone';
global.LOOK_POWER_CREEPS = 'powerCreep';
global.LOOK_RUINS = 'ruin';

// Mock terrain constants
global.TERRAIN_MASK_WALL = 1;
global.TERRAIN_MASK_SWAMP = 2;
global.TERRAIN_MASK_LAVA = 4;

// Mock resource types
global.RESOURCE_ENERGY = 'energy';
global.RESOURCE_POWER = 'power';
global.RESOURCE_HYDROGEN = 'H';
global.RESOURCE_OXYGEN = 'O';
global.RESOURCE_UTRIUM = 'U';
global.RESOURCE_LEMERGIUM = 'L';
global.RESOURCE_KEANIUM = 'K';
global.RESOURCE_ZYNTHIUM = 'Z';
global.RESOURCE_CATALYST = 'X';
global.RESOURCE_GHODIUM = 'G';

// Tier 1 compounds
global.RESOURCE_HYDROXIDE = 'OH';
global.RESOURCE_ZYNTHIUM_KEANITE = 'ZK';
global.RESOURCE_UTRIUM_LEMERGITE = 'UL';
global.RESOURCE_GHODIUM = 'G';

// Tier 2 compounds  
global.RESOURCE_UTRIUM_HYDRIDE = 'UH';
global.RESOURCE_UTRIUM_OXIDE = 'UO';
global.RESOURCE_KEANIUM_HYDRIDE = 'KH';
global.RESOURCE_KEANIUM_OXIDE = 'KO';
global.RESOURCE_LEMERGIUM_HYDRIDE = 'LH';
global.RESOURCE_LEMERGIUM_OXIDE = 'LO';
global.RESOURCE_ZYNTHIUM_HYDRIDE = 'ZH';
global.RESOURCE_ZYNTHIUM_OXIDE = 'ZO';
global.RESOURCE_GHODIUM_HYDRIDE = 'GH';
global.RESOURCE_GHODIUM_OXIDE = 'GO';

// Tier 3 compounds
global.RESOURCE_UTRIUM_ACID = 'UH2O';
global.RESOURCE_UTRIUM_ALKALIDE = 'UHO2';
global.RESOURCE_KEANIUM_ACID = 'KH2O';
global.RESOURCE_KEANIUM_ALKALIDE = 'KHO2';
global.RESOURCE_LEMERGIUM_ACID = 'LH2O';
global.RESOURCE_LEMERGIUM_ALKALIDE = 'LHO2';
global.RESOURCE_ZYNTHIUM_ACID = 'ZH2O';
global.RESOURCE_ZYNTHIUM_ALKALIDE = 'ZHO2';
global.RESOURCE_GHODIUM_ACID = 'GH2O';
global.RESOURCE_GHODIUM_ALKALIDE = 'GHO2';

// Commodities
global.RESOURCE_CATALYZED_UTRIUM_ACID = 'XUH2O';
global.RESOURCE_CATALYZED_UTRIUM_ALKALIDE = 'XUHO2';
global.RESOURCE_CATALYZED_KEANIUM_ACID = 'XKH2O';
global.RESOURCE_CATALYZED_KEANIUM_ALKALIDE = 'XKHO2';
global.RESOURCE_CATALYZED_LEMERGIUM_ACID = 'XLH2O';
global.RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE = 'XLHO2';
global.RESOURCE_CATALYZED_ZYNTHIUM_ACID = 'XZH2O';
global.RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE = 'XZHO2';
global.RESOURCE_CATALYZED_GHODIUM_ACID = 'XGH2O';
global.RESOURCE_CATALYZED_GHODIUM_ALKALIDE = 'XGHO2';

// Other resources
global.RESOURCE_OPS = 'ops';
global.RESOURCE_UTRIUM_BAR = 'utrium_bar';
global.RESOURCE_LEMERGIUM_BAR = 'lemergium_bar';
global.RESOURCE_ZYNTHIUM_BAR = 'zynthium_bar';
global.RESOURCE_KEANIUM_BAR = 'keanium_bar';
global.RESOURCE_GHODIUM_MELT = 'ghodium_melt';
global.RESOURCE_OXIDANT = 'oxidant';
global.RESOURCE_REDUCTANT = 'reductant';
global.RESOURCE_PURIFIER = 'purifier';
global.RESOURCE_BATTERY = 'battery';
global.RESOURCE_COMPOSITE = 'composite';
global.RESOURCE_CRYSTAL = 'crystal';
global.RESOURCE_LIQUID = 'liquid';
global.RESOURCE_WIRE = 'wire';
global.RESOURCE_SWITCH = 'switch';
global.RESOURCE_TRANSISTOR = 'transistor';
global.RESOURCE_MICROCHIP = 'microchip';
global.RESOURCE_CIRCUIT = 'circuit';
global.RESOURCE_DEVICE = 'device';
global.RESOURCE_CELL = 'cell';
global.RESOURCE_PHLEGM = 'phlegm';
global.RESOURCE_TISSUE = 'tissue';
global.RESOURCE_MUSCLE = 'muscle';
global.RESOURCE_ORGANOID = 'organoid';
global.RESOURCE_ORGANISM = 'organism';
global.RESOURCE_ALLOY = 'alloy';
global.RESOURCE_TUBE = 'tube';
global.RESOURCE_FIXTURES = 'fixtures';
global.RESOURCE_FRAME = 'frame';
global.RESOURCE_HYDRAULICS = 'hydraulics';
global.RESOURCE_MACHINE = 'machine';
global.RESOURCE_CONDENSATE = 'condensate';
global.RESOURCE_CONCENTRATE = 'concentrate';
global.RESOURCE_EXTRACT = 'extract';
global.RESOURCE_SPIRIT = 'spirit';
global.RESOURCE_EMANATION = 'emanation';
global.RESOURCE_ESSENCE = 'essence';

// Mock body part constants
global.MOVE = 'move';
global.WORK = 'work';
global.CARRY = 'carry';
global.ATTACK = 'attack';
global.RANGED_ATTACK = 'ranged_attack';
global.TOUGH = 'tough';
global.HEAL = 'heal';
global.CLAIM = 'claim';

// Mock game mode constants
global.MODE_SIMULATION = 'simulation';
global.MODE_WORLD = 'world';

// Mock direction constants
global.TOP = 1;
global.TOP_RIGHT = 2;
global.RIGHT = 3;
global.BOTTOM_RIGHT = 4;
global.BOTTOM = 5;
global.BOTTOM_LEFT = 6;
global.LEFT = 7;
global.TOP_LEFT = 8;

// Mock color constants
global.COLOR_RED = 1;
global.COLOR_PURPLE = 2;
global.COLOR_BLUE = 3;
global.COLOR_CYAN = 4;
global.COLOR_GREEN = 5;
global.COLOR_YELLOW = 6;
global.COLOR_ORANGE = 7;
global.COLOR_BROWN = 8;
global.COLOR_GREY = 9;
global.COLOR_WHITE = 10;

// Mock other useful constants
global.CREEP_LIFE_TIME = 1500;
global.CREEP_CLAIM_LIFE_TIME = 600;
global.CREEP_CORPSE_RATE = 0.2;
global.CREEP_SPAWN_TIME = 3;
global.OBSTACLE_OBJECT_TYPES = ['spawn', 'creep', 'wall', 'source', 'constructedWall', 'extension', 'link', 'storage', 'tower', 'observer', 'powerSpawn', 'powerBank', 'lab', 'terminal', 'nuker', 'factory', 'invaderCore'];
global.BODYPART_COST = {
  move: 50,
  work: 100,
  attack: 80,
  carry: 50,
  heal: 250,
  ranged_attack: 150,
  tough: 10,
  claim: 600
};

// CPU and pixel constants
global.PIXEL_CPU_COST = 10000;
global.CPU_POWER_CREDIT_COST = 0.01;

// Structure constants
global.SPAWN_ENERGY_CAPACITY = 300;
global.SPAWN_ENERGY_START = 300;
global.SPAWN_HITS = 5000;
global.STORAGE_CAPACITY = 1000000;
global.STORAGE_HITS = 10000;
global.TERMINAL_CAPACITY = 300000;
global.TERMINAL_HITS = 3000;
global.LINK_CAPACITY = 800;
global.LINK_COOLDOWN = 1;
global.LINK_LOSS_RATIO = 0.03;
global.LINK_HITS = 1000;
global.LINK_HITS_MAX = 1000;
global.TOWER_CAPACITY = 1000;
global.TOWER_HITS = 3000;
global.TOWER_ENERGY_COST = 10;
global.TOWER_POWER_ATTACK = 600;
global.TOWER_POWER_HEAL = 400;
global.TOWER_POWER_REPAIR = 800;
global.TOWER_OPTIMAL_RANGE = 5;
global.TOWER_FALLOFF_RANGE = 20;
global.TOWER_FALLOFF = 0.75;
global.LAB_HITS = 500;
global.LAB_MINERAL_CAPACITY = 3000;
global.LAB_ENERGY_CAPACITY = 2000;
global.LAB_BOOST_ENERGY = 20;
global.LAB_BOOST_MINERAL = 30;
global.LAB_COOLDOWN = 10;
global.LAB_REACTION_AMOUNT = 5;
global.NUKER_HITS = 1000;
global.NUKER_COOLDOWN = 100000;
global.NUKER_ENERGY_CAPACITY = 300000;
global.NUKER_GHODIUM_CAPACITY = 5000;
global.NUKE_LAND_TIME = 50000;
global.NUKE_RANGE = 2;
global.NUKE_DAMAGE = {
  0: 10000000,
  2: 5000000
};
global.FACTORY_HITS = 1000;
global.FACTORY_CAPACITY = 50000;
global.POWER_SPAWN_HITS = 5000;
global.POWER_SPAWN_ENERGY_CAPACITY = 5000;
global.POWER_SPAWN_POWER_CAPACITY = 100;
global.POWER_SPAWN_ENERGY_RATIO = 50;
global.EXTRACTOR_HITS = 500;
global.EXTRACTOR_COOLDOWN = 5;
global.OBSERVER_HITS = 500;
global.OBSERVER_RANGE = 10;
global.EXTENSION_HITS = 1000;
global.EXTENSION_ENERGY_CAPACITY = { 0: 50, 1: 50, 2: 50, 3: 50, 4: 50, 5: 50, 6: 50, 7: 100, 8: 200 };
global.ROAD_HITS = 5000;
global.ROAD_WEAROUT = 1;
global.ROAD_DECAY_AMOUNT = 100;
global.ROAD_DECAY_TIME = 1000;
global.CONTAINER_HITS = 250000;
global.CONTAINER_CAPACITY = 2000;
global.CONTAINER_DECAY = 5000;
global.CONTAINER_DECAY_TIME = 100;
global.CONTAINER_DECAY_TIME_OWNED = 500;
global.RAMPART_HITS = 1;
global.RAMPART_HITS_MAX = { 2: 300000, 3: 1000000, 4: 3000000, 5: 10000000, 6: 30000000, 7: 100000000, 8: 300000000 };
global.RAMPART_DECAY_AMOUNT = 300;
global.RAMPART_DECAY_TIME = 100;
global.WALL_HITS = 1;
global.WALL_HITS_MAX = 300000000;
global.REPAIR_COST = 0.01;
global.REPAIR_POWER = 100;

// Energy and source constants
global.ENERGY_REGEN_TIME = 300;
global.ENERGY_DECAY = 1000;
global.SOURCE_ENERGY_CAPACITY = 3000;
global.SOURCE_ENERGY_NEUTRAL_CAPACITY = 1500;
global.SOURCE_ENERGY_KEEPER_CAPACITY = 4000;

// Power constants
global.POWER_BANK_HITS = 2000000;
global.POWER_BANK_CAPACITY_MAX = 5000;
global.POWER_BANK_CAPACITY_MIN = 500;
global.POWER_BANK_CAPACITY_CRIT = 0.3;
global.POWER_BANK_DECAY = 5000;
global.POWER_BANK_HIT_BACK = 0.5;

// Controller constants
global.CONTROLLER_LEVELS = { 1: 200, 2: 45000, 3: 135000, 4: 405000, 5: 1215000, 6: 3645000, 7: 10935000, 8: 0 };
global.CONTROLLER_DOWNGRADE = { 1: 20000, 2: 10000, 3: 20000, 4: 40000, 5: 80000, 6: 120000, 7: 150000, 8: 200000 };
global.CONTROLLER_CLAIM_DOWNGRADE = 300;
global.CONTROLLER_RESERVE = 1;
global.CONTROLLER_RESERVE_MAX = 5000;
global.CONTROLLER_MAX_UPGRADE_PER_TICK = 15;
global.CONTROLLER_ATTACK_BLOCKED_UPGRADE = 1000;
global.CONTROLLER_NUKE_BLOCKED_UPGRADE = 200;

// Safe mode constants
global.SAFE_MODE_DURATION = 20000;
global.SAFE_MODE_COOLDOWN = 50000;
global.SAFE_MODE_COST = 1000;

// Market constants
global.MARKET_FEE = 0.05;
global.MAX_MARKET_ORDERS = 300;
global.MAX_CREEP_SIZE = 50;

// Mock InterShardMemory
global.InterShardMemory = {
  getLocal: () => null,
  setLocal: () => undefined,
  getRemote: () => null
};

// Mock RawMemory
global.RawMemory = {
  get: () => JSON.stringify(global.Memory),
  set: (value) => { global.Memory = JSON.parse(value); },
  setActiveSegments: () => undefined,
  segments: {},
  foreignSegment: undefined,
  setActiveForeignSegment: () => undefined,
  setDefaultPublicSegment: () => undefined,
  setPublicSegments: () => undefined
};

// Mock PathFinder
global.PathFinder = {
  search: () => ({ path: [], ops: 0, cost: 0, incomplete: false }),
  CostMatrix: class {
    _bits = new Uint8Array(2500);
    set(x, y, val) { this._bits[x * 50 + y] = val; }
    get(x, y) { return this._bits[x * 50 + y]; }
    clone() { const m = new global.PathFinder.CostMatrix(); m._bits = new Uint8Array(this._bits); return m; }
    serialize() { return Array.from(this._bits); }
    static deserialize(data) { const m = new global.PathFinder.CostMatrix(); m._bits = new Uint8Array(data); return m; }
  }
};

// Mock RoomPosition
global.RoomPosition = class RoomPosition {
  constructor(x, y, roomName) {
    this.x = x;
    this.y = y;
    this.roomName = roomName;
  }
  isEqualTo(target) {
    return this.x === target.x && this.y === target.y && this.roomName === target.roomName;
  }
  isNearTo(target) {
    if (this.roomName !== target.roomName) return false;
    return Math.abs(this.x - target.x) <= 1 && Math.abs(this.y - target.y) <= 1;
  }
  getRangeTo(target) {
    if (this.roomName !== target.roomName) return Infinity;
    return Math.max(Math.abs(this.x - target.x), Math.abs(this.y - target.y));
  }
  getDirectionTo(target) {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    if (dx > 0) {
      if (dy > 0) return BOTTOM_RIGHT;
      if (dy < 0) return TOP_RIGHT;
      return RIGHT;
    }
    if (dx < 0) {
      if (dy > 0) return BOTTOM_LEFT;
      if (dy < 0) return TOP_LEFT;
      return LEFT;
    }
    if (dy > 0) return BOTTOM;
    if (dy < 0) return TOP;
    return 0;
  }
  findPathTo() { return []; }
  findClosestByPath() { return null; }
  findClosestByRange() { return null; }
  findInRange() { return []; }
  look() { return []; }
  lookFor() { return []; }
  createFlag() { return ''; }
  createConstructionSite() { return OK; }
};
