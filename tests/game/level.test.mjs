import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LEVEL_888 } from '../../assets/Game/Config/Level888.ts';
import { RECOMMENDED_SOLUTION_888 } from '../../assets/Game/Config/RecommendedSolution888.ts';
import { PRESENTATION_CONFIG } from '../../assets/Game/Config/PresentationConfig.ts';
import { validateLevel } from '../../assets/Game/Domain/LevelValidator.ts';

// 以下期望表由 MVP_FINAL §7.1/§7.2/§7.3 手工转录，
// 不调用 Level888 或 LevelValidator 生成“标准答案”。
const EXPECTED_BLOCKS = {
    B01: { groupId: 'G01', kind: 'single', cards: ['tong:1'] },
    B02: { groupId: 'G01', kind: 'identicalPair', cards: ['tong:1', 'tong:1'] },
    B03: { groupId: 'G02', kind: 'single', cards: ['tong:2'] },
    B04: { groupId: 'G02', kind: 'identicalPair', cards: ['tong:2', 'tong:2'] },
    B05: { groupId: 'G03', kind: 'single', cards: ['tong:3'] },
    B06: { groupId: 'G03', kind: 'identicalPair', cards: ['tong:3', 'tong:3'] },
    B07: { groupId: 'G04', kind: 'identicalPair', cards: ['tong:4', 'tong:4'] },
    B08: { groupId: 'G04', kind: 'identicalPair', cards: ['tong:4', 'tong:4'] },
    B09: { groupId: 'G05', kind: 'single', cards: ['tong:5'] },
    B10: { groupId: 'G05', kind: 'single', cards: ['tong:5'] },
    B11: { groupId: 'G06', kind: 'single', cards: ['wan:6'] },
    B12: { groupId: 'G06', kind: 'sequencePair', cards: ['wan:7', 'wan:8'] },
    B13: { groupId: 'G07', kind: 'single', cards: ['wan:7'] },
    B14: { groupId: 'G07', kind: 'sequencePair', cards: ['wan:8', 'wan:9'] },
    B15: { groupId: 'G08', kind: 'single', cards: ['tiao:6'] },
    B16: { groupId: 'G08', kind: 'identicalPair', cards: ['tiao:6', 'tiao:6'] },
    B17: { groupId: 'G09', kind: 'single', cards: ['tiao:7'] },
    B18: { groupId: 'G09', kind: 'identicalPair', cards: ['tiao:7', 'tiao:7'] },
    B19: { groupId: 'G10', kind: 'single', cards: ['tiao:1'] },
    B20: { groupId: 'G10', kind: 'sequencePair', cards: ['tiao:2', 'tiao:3'] },
    B21: { groupId: 'G11', kind: 'single', cards: ['wan:2'] },
    B22: { groupId: 'G11', kind: 'sequencePair', cards: ['wan:3', 'wan:4'] },
    B23: { groupId: 'G12', kind: 'single', cards: ['wan:3'] },
    B24: { groupId: 'G12', kind: 'sequencePair', cards: ['wan:4', 'wan:5'] },
    B25: { groupId: 'G13', kind: 'single', cards: ['tiao:9'] },
    B26: { groupId: 'G13', kind: 'identicalPair', cards: ['tiao:9', 'tiao:9'] },
    B27: { groupId: 'G14', kind: 'single', cards: ['wan:1'] },
    B28: { groupId: 'G14', kind: 'sequencePair', cards: ['wan:2', 'wan:3'] },
    B29: { groupId: 'G15', kind: 'single', cards: ['tiao:4'] },
    B30: { groupId: 'G15', kind: 'sequencePair', cards: ['tiao:5', 'tiao:6'] },
    B31: { groupId: 'G16', kind: 'single', cards: ['wan:7'] },
    B32: { groupId: 'G16', kind: 'sequencePair', cards: ['wan:8', 'wan:9'] },
};

const EXPECTED_GROUPS = {
    G01: ['B01', 'B02'], G02: ['B03', 'B04'], G03: ['B05', 'B06'], G04: ['B07', 'B08'],
    G05: ['B09', 'B10'], G06: ['B11', 'B12'], G07: ['B13', 'B14'], G08: ['B15', 'B16'],
    G09: ['B17', 'B18'], G10: ['B19', 'B20'], G11: ['B21', 'B22'], G12: ['B23', 'B24'],
    G13: ['B25', 'B26'], G14: ['B27', 'B28'], G15: ['B29', 'B30'], G16: ['B31', 'B32'],
};

const EXPECTED_GROUP_CATEGORY = {
    G01: 'peng', G02: 'peng', G03: 'peng', G04: 'kong', G05: 'pair',
    G06: 'chi', G07: 'chi', G08: 'peng', G09: 'peng', G10: 'chi',
    G11: 'chi', G12: 'chi', G13: 'peng', G14: 'chi', G15: 'chi', G16: 'chi',
};

const BLOCKED_BY_FIRST = ['G01', 'G02', 'G03', 'G04', 'G05'];
const BLOCKED_BY_SECOND = ['G06', 'G07', 'G08', 'G09', 'G10'];

const place = (x, y, layer, blockedBy) => ({ x, y, layer, blockedBy });
const EXPECTED_PLACEMENTS = {
    B01: place(64, 160, 3, []), B02: place(188, 160, 3, []),
    B03: place(396, 160, 3, []), B04: place(520, 160, 3, []),
    B05: place(64, 300, 3, []), B06: place(188, 300, 3, []),
    B07: place(396, 300, 3, []), B08: place(520, 300, 3, []),
    B09: place(220, 440, 3, []), B10: place(380, 440, 3, []),
    B11: place(64, 300, 2, BLOCKED_BY_FIRST), B12: place(188, 300, 2, BLOCKED_BY_FIRST),
    B13: place(396, 300, 2, BLOCKED_BY_FIRST), B14: place(520, 300, 2, BLOCKED_BY_FIRST),
    B15: place(64, 440, 2, BLOCKED_BY_FIRST), B16: place(188, 440, 2, BLOCKED_BY_FIRST),
    B17: place(396, 440, 2, BLOCKED_BY_FIRST), B18: place(520, 440, 2, BLOCKED_BY_FIRST),
    B19: place(220, 580, 2, BLOCKED_BY_FIRST), B20: place(380, 580, 2, BLOCKED_BY_FIRST),
    B21: place(64, 440, 1, BLOCKED_BY_SECOND), B22: place(188, 440, 1, BLOCKED_BY_SECOND),
    B23: place(396, 440, 1, BLOCKED_BY_SECOND), B24: place(520, 440, 1, BLOCKED_BY_SECOND),
    B25: place(64, 580, 1, BLOCKED_BY_SECOND), B26: place(188, 580, 1, BLOCKED_BY_SECOND),
    B27: place(396, 580, 1, BLOCKED_BY_SECOND), B28: place(520, 580, 1, BLOCKED_BY_SECOND),
    B29: place(64, 720, 1, BLOCKED_BY_SECOND), B30: place(188, 720, 1, BLOCKED_BY_SECOND),
    B31: place(396, 720, 1, BLOCKED_BY_SECOND), B32: place(520, 720, 1, BLOCKED_BY_SECOND),
};

const EXPECTED_CARD_COUNTS = {
    'tong:1': 3, 'tong:2': 3, 'tong:3': 3, 'tong:4': 4, 'tong:5': 2,
    'wan:1': 1, 'wan:2': 2, 'wan:3': 3, 'wan:4': 2, 'wan:5': 1,
    'wan:6': 1, 'wan:7': 3, 'wan:8': 3, 'wan:9': 2,
    'tiao:1': 1, 'tiao:2': 1, 'tiao:3': 1, 'tiao:4': 1, 'tiao:5': 1,
    'tiao:6': 4, 'tiao:7': 3, 'tiao:9': 3,
};

const face = card => `${card.suit}:${card.rank}`;
const cardsOf = cards => cards.map(face);
const cloneLevel = () => structuredClone(LEVEL_888);
const issueCodes = issues => new Set(issues.map(issue => issue.code));
const validateMutated = mutate => {
    const level = cloneLevel();
    mutate(level);
    return validateLevel(level);
};
const placementOf = (level, blockId) => level.placements.find(placement => placement.blockId === blockId);
const blockOf = (level, blockId) => level.blocks.find(block => block.id === blockId);

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
}

test('fixed level declares the exact 32 blocks, 16 groups and 48 tiles', () => {
    assert.equal(LEVEL_888.id, '888');
    assert.equal(LEVEL_888.contentVersion, '888-v3');
    assert.equal(LEVEL_888.blocks.length, 32);
    assert.equal(LEVEL_888.groups.length, 16);
    assert.equal(LEVEL_888.placements.length, 32);
    assert.equal(LEVEL_888.blocks.reduce((total, block) => total + block.cards.length, 0), 48);
    assert.equal(LEVEL_888.blocks.filter(block => block.kind === 'single').length, 16);
    assert.equal(LEVEL_888.blocks.filter(block => block.kind !== 'single').length, 16);
});

test('card pool matches the hand-transcribed counts and never exceeds four copies', () => {
    const counts = {};
    for (const block of LEVEL_888.blocks) {
        for (const card of block.cards) counts[face(card)] = (counts[face(card)] ?? 0) + 1;
    }
    assert.deepEqual(counts, EXPECTED_CARD_COUNTS);
    for (const [card, count] of Object.entries(counts)) {
        assert.ok(count <= 4, `${card} has ${count} copies`);
    }
});

test('every block matches its hand-transcribed group, kind and card faces', () => {
    assert.equal(LEVEL_888.blocks.length, Object.keys(EXPECTED_BLOCKS).length);
    for (const block of LEVEL_888.blocks) {
        const expected = EXPECTED_BLOCKS[block.id];
        assert.ok(expected, `unexpected block ${block.id}`);
        assert.equal(block.groupId, expected.groupId, `${block.id} group`);
        assert.equal(block.kind, expected.kind, `${block.id} kind`);
        assert.deepEqual(cardsOf(block.cards), expected.cards, `${block.id} cards`);
    }
    assert.deepEqual(new Set(LEVEL_888.blocks.map(block => block.id)), new Set(Object.keys(EXPECTED_BLOCKS)));
});

test('every group matches the hand-transcribed block pair and category counts', () => {
    const actualCategories = { chi: 0, peng: 0, kong: 0, pair: 0 };
    for (const group of LEVEL_888.groups) {
        assert.deepEqual(group.blockIds, EXPECTED_GROUPS[group.id], `${group.id} blockIds`);
        actualCategories[EXPECTED_GROUP_CATEGORY[group.id]]++;
    }
    assert.deepEqual(actualCategories, { chi: 8, peng: 6, kong: 1, pair: 1 });
    assert.equal(actualCategories.chi + actualCategories.peng, 14);
});

test('every placement matches exact coordinates, layer and blockedBy list', () => {
    assert.equal(LEVEL_888.placements.length, Object.keys(EXPECTED_PLACEMENTS).length);
    for (const placement of LEVEL_888.placements) {
        const expected = EXPECTED_PLACEMENTS[placement.blockId];
        assert.ok(expected, `unexpected placement ${placement.blockId}`);
        assert.equal(placement.x, expected.x, `${placement.blockId} x`);
        assert.equal(placement.y, expected.y, `${placement.blockId} y`);
        assert.equal(placement.layer, expected.layer, `${placement.blockId} layer`);
        assert.deepEqual(placement.blockedBy, expected.blockedBy, `${placement.blockId} blockedBy`);
    }
});

test('initial selectable set is exactly B01-B10', () => {
    const actual = LEVEL_888.placements
        .filter(placement => placement.blockedBy.length === 0)
        .map(placement => placement.blockId)
        .sort();
    const expected = Object.entries(EXPECTED_PLACEMENTS)
        .filter(([, placement]) => placement.blockedBy.length === 0)
        .map(([blockId]) => blockId)
        .sort();
    assert.deepEqual(actual, expected);
    assert.deepEqual(actual, Array.from({ length: 10 }, (_, index) => `B${String(index + 1).padStart(2, '0')}`));
});

test('group members share a layer and each blocker is a strictly higher layer', () => {
    for (const group of LEVEL_888.groups) {
        const [first, second] = group.blockIds.map(blockId => placementOf(LEVEL_888, blockId));
        assert.equal(first.layer, second.layer, `${group.id} layer mismatch`);
    }
    for (const placement of LEVEL_888.placements) {
        for (const blockerId of placement.blockedBy) {
            const blocker = LEVEL_888.groups.find(group => group.id === blockerId);
            assert.ok(blocker, `${blockerId} must exist`);
            for (const blockId of blocker.blockIds) {
                const blockerPlacement = placementOf(LEVEL_888, blockId);
                assert.ok(blockerPlacement.layer > placement.layer,
                    `${placement.blockId} (layer ${placement.layer}) blocked by ${blockerId} (layer ${blockerPlacement.layer})`);
            }
        }
    }
});

test('validator accepts the fixed level without mutating it', () => {
    const before = JSON.stringify(LEVEL_888);
    const frozen = deepFreeze(cloneLevel());
    assert.deepEqual(validateLevel(frozen), []);
    assert.equal(JSON.stringify(LEVEL_888), before);
});

test('validator reports duplicate, missing and unexpected block IDs', () => {
    const duplicate = validateMutated(level => { level.blocks[1].id = 'B01'; });
    assert.ok(issueCodes(duplicate).has('block-id-duplicate'));
    assert.ok(issueCodes(duplicate).has('block-id-missing'));
    assert.ok(issueCodes(duplicate).has('group-block-reference'));
    assert.ok(issueCodes(duplicate).has('placement-block-reference'));

    const missing = validateMutated(level => { level.blocks.pop(); });
    assert.ok(issueCodes(missing).has('block-id-missing'));
    assert.ok(issueCodes(missing).has('level-block-count'));
    assert.ok(issueCodes(missing).has('level-tile-count'));

    const unexpected = validateMutated(level => {
        level.blocks.push({ id: 'B33', groupId: 'G16', kind: 'single', cards: [{ suit: 'wan', rank: 1 }] });
    });
    assert.ok(issueCodes(unexpected).has('block-id-unexpected'));
    assert.ok(issueCodes(unexpected).has('level-block-count'));
});

test('validator reports duplicate, missing and unexpected group IDs', () => {
    const duplicate = validateMutated(level => { level.groups[1].id = 'G01'; });
    assert.ok(issueCodes(duplicate).has('group-id-duplicate'));
    assert.ok(issueCodes(duplicate).has('group-id-missing'));
    assert.ok(issueCodes(duplicate).has('group-block-owner'));

    const missing = validateMutated(level => { level.groups.pop(); });
    assert.ok(issueCodes(missing).has('group-id-missing'));
    assert.ok(issueCodes(missing).has('level-group-count'));
    assert.ok(issueCodes(missing).has('block-group-reference'));

    const unexpected = validateMutated(level => {
        level.groups.push({ id: 'G17', blockIds: ['B01', 'B02'] });
    });
    assert.ok(issueCodes(unexpected).has('group-id-unexpected'));
    assert.ok(issueCodes(unexpected).has('level-group-count'));
});

test('validator reports bad group references, size, ownership and layer mismatch', () => {
    const badReference = validateMutated(level => { level.groups[0].blockIds = ['B01', 'B99']; });
    assert.ok(issueCodes(badReference).has('group-block-reference'));

    const badSize = validateMutated(level => { level.groups[0].blockIds = ['B01']; });
    assert.ok(issueCodes(badSize).has('group-block-count'));

    const badOwner = validateMutated(level => { level.groups[0].blockIds = ['B01', 'B03']; });
    assert.ok(issueCodes(badOwner).has('group-block-owner'));

    const badLayer = validateMutated(level => { placementOf(level, 'B02').layer = 2; });
    assert.ok(issueCodes(badLayer).has('group-layer-mismatch'));
});

test('validator reports illegal single, identical-pair and sequence-pair cards', () => {
    const badSingle = validateMutated(level => {
        level.blocks[0].cards = [{ suit: 'tong', rank: 1 }, { suit: 'tong', rank: 1 }];
    });
    assert.ok(issueCodes(badSingle).has('block-card-count'));

    const badPair = validateMutated(level => { level.blocks[1].cards[1].rank = 2; });
    assert.ok(issueCodes(badPair).has('block-pair-not-identical'));

    const crossSuit = validateMutated(level => { level.blocks[11].cards[1].suit = 'tiao'; });
    assert.ok(issueCodes(crossSuit).has('block-sequence-suit'));

    const wrongOrder = validateMutated(level => {
        level.blocks[11].cards = [{ suit: 'wan', rank: 7 }, { suit: 'wan', rank: 9 }];
    });
    assert.ok(issueCodes(wrongOrder).has('block-sequence-order'));

    const badKind = validateMutated(level => { level.blocks[0].kind = 'triple'; });
    assert.ok(issueCodes(badKind).has('block-kind'));
});

test('validator reports illegal group composition and category totals', () => {
    const badComposition = validateMutated(level => {
        level.blocks[1].cards = [{ suit: 'tong', rank: 2 }, { suit: 'tong', rank: 2 }];
    });
    assert.ok(issueCodes(badComposition).has('group-composition'));

    const badCategories = validateMutated(level => {
        level.blocks[5] = { id: 'B06', groupId: 'G03', kind: 'single', cards: [{ suit: 'tong', rank: 3 }] };
    });
    assert.ok(issueCodes(badCategories).has('group-category-count'));
});

test('validator reports card overflow, tile count and coordinate problems', () => {
    const tooManyCards = validateMutated(level => {
        blockOf(level, 'B13').cards = [{ suit: 'tong', rank: 4 }];
    });
    assert.ok(issueCodes(tooManyCards).has('card-count-exceeded'));

    const wrongTileCount = validateMutated(level => { blockOf(level, 'B01').cards = []; });
    assert.ok(issueCodes(wrongTileCount).has('level-tile-count'));

    const outOfBounds = validateMutated(level => { placementOf(level, 'B01').x = 10; });
    assert.ok(issueCodes(outOfBounds).has('placement-out-of-bounds'));

    const nonFinite = validateMutated(level => { placementOf(level, 'B01').x = Number.NaN; });
    assert.ok(issueCodes(nonFinite).has('placement-coordinate'));

    const missingPlacement = validateMutated(level => {
        level.placements = level.placements.filter(placement => placement.blockId !== 'B10');
    });
    assert.ok(issueCodes(missingPlacement).has('placement-missing'));
    assert.ok(issueCodes(missingPlacement).has('initial-selectable-mismatch'));

    const duplicatePlacement = validateMutated(level => {
        level.placements.push(structuredClone(placementOf(level, 'B01')));
    });
    assert.ok(issueCodes(duplicatePlacement).has('placement-duplicate'));
});

test('validator reports blocking reference errors, self-dependency and cycles', () => {
    const badReference = validateMutated(level => { placementOf(level, 'B11').blockedBy.push('G99'); });
    assert.ok(issueCodes(badReference).has('blocking-reference'));

    const selfDependency = validateMutated(level => { placementOf(level, 'B11').blockedBy.push('G06'); });
    assert.ok(issueCodes(selfDependency).has('blocking-self'));
    assert.ok(issueCodes(selfDependency).has('blocking-cycle'));

    const cycle = validateMutated(level => {
        placementOf(level, 'B01').blockedBy.push('G16');
        placementOf(level, 'B31').blockedBy.push('G01');
    });
    assert.ok(issueCodes(cycle).has('blocking-cycle'));

    const initialMismatch = validateMutated(level => { placementOf(level, 'B01').blockedBy.push('G16'); });
    assert.ok(issueCodes(initialMismatch).has('initial-selectable-mismatch'));
});

test('validator returns every issue instead of stopping at the first one', () => {
    const issues = validateMutated(level => {
        level.blocks[0].id = 'B02';
        level.groups[0].blockIds = ['B01', 'B99'];
        placementOf(level, 'B01').x = -5;
        level.blocks[5].cards[0].suit = 'bamboo';
    });
    const codes = issueCodes(issues);
    for (const code of ['block-id-duplicate', 'group-block-reference', 'placement-out-of-bounds', 'card-suit']) {
        assert.ok(codes.has(code), `missing ${code}: ${Array.from(codes).join(', ')}`);
    }
    assert.ok(issues.length >= 4);
});

test('recommended solution is data-only B01-B10 then B21-B32', () => {
    assert.deepEqual(RECOMMENDED_SOLUTION_888, [
        'B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10',
        'B21', 'B22', 'B23', 'B24', 'B25', 'B26', 'B27', 'B28', 'B29', 'B30', 'B31', 'B32',
    ]);
    assert.equal(new Set(RECOMMENDED_SOLUTION_888).size, 22);
    for (const blockId of RECOMMENDED_SOLUTION_888) assert.ok(blockOf(LEVEL_888, blockId), blockId);

    const source = fs.readFileSync(new URL('../../assets/Game/Config/RecommendedSolution888.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bWon\b|\bLost\b|dispatch|terminal|sessionId/);
});

test('presentation physics and effect deadlines respect the architecture hard limits', () => {
    assert.equal(PRESENTATION_CONFIG.physics.physicsProxyTimeoutMs, 900);
    assert.equal(PRESENTATION_CONFIG.physics.effectTimeoutMs, 1500);
    assert.equal(PRESENTATION_CONFIG.timing.resultPanelDelayMs, 1500);
    assert.ok(PRESENTATION_CONFIG.physics.physicsProxyTimeoutMs <= PRESENTATION_CONFIG.physics.effectTimeoutMs);
    assert.ok(PRESENTATION_CONFIG.timing.resultPanelDelayMs <= PRESENTATION_CONFIG.physics.effectTimeoutMs);
    assert.equal(PRESENTATION_CONFIG.physics.maxDynamicBodies, 12);
    assert.equal(PRESENTATION_CONFIG.physics.maxUltimateGroups, 5);
});

test('presentation camera explicitly separates design pixels, world units and orthographic half-height', () => {
    const camera = PRESENTATION_CONFIG.camera;
    assert.equal(camera.designPixelsPerWorldUnit, 100);
    assert.equal(camera.orthoHalfHeightWorld, 6.4);
    assert.equal(camera.orthoHalfHeightWorld * 2 * camera.designPixelsPerWorldUnit, 1280);
    assert.equal(PRESENTATION_CONFIG.block.singleWidth / camera.designPixelsPerWorldUnit, 0.64);
    assert.equal(PRESENTATION_CONFIG.block.doubleWidth / camera.designPixelsPerWorldUnit, 1.32);
    assert.equal(PRESENTATION_CONFIG.block.height / camera.designPixelsPerWorldUnit, 0.88);
    assert.equal('orthographicHeight' in camera, false, 'ambiguous pixel-based camera height must not remain');
});

test('presentation config contains primitives only and no rule data', () => {
    const allowedKeys = new Set(['designSize', 'block', 'colors', 'timing', 'physics', 'camera']);
    const forbiddenKeys = new Set(['blocks', 'groups', 'placements', 'cards', 'melds', 'phase', 'terminal', 'sessionId']);
    const visit = (value, path) => {
        if (Array.isArray(value)) {
            for (let index = 0; index < value.length; index++) visit(value[index], `${path}[${index}]`);
            return;
        }
        if (value && typeof value === 'object') {
            for (const [key, child] of Object.entries(value)) {
                assert.ok(!forbiddenKeys.has(key), `forbidden presentation key ${path}.${key}`);
                visit(child, `${path}.${key}`);
            }
            return;
        }
        assert.ok(['number', 'string', 'boolean'].includes(typeof value), `non-primitive at ${path}`);
    };
    visit(PRESENTATION_CONFIG, 'PRESENTATION_CONFIG');
    assert.deepEqual(new Set(Object.keys(PRESENTATION_CONFIG)), allowedKeys);
    assert.equal(PRESENTATION_CONFIG.designSize.width, 720);
    assert.equal(PRESENTATION_CONFIG.designSize.height, 1280);
    assert.equal(PRESENTATION_CONFIG.block.singleWidth, 64);
    assert.equal(PRESENTATION_CONFIG.block.doubleWidth, 132);
    assert.equal(PRESENTATION_CONFIG.block.height, 88);
    assert.equal(PRESENTATION_CONFIG.physics.maxDynamicBodies, 12);

    const source = fs.readFileSync(new URL('../../assets/Game/Config/PresentationConfig.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['"]cc(?:\/env)?['"]|require\s*\(/);
});
