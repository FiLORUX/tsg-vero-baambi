/**
 * Storage Migration Test
 * Verifies that migration does not corrupt existing data
 */

// Mock localStorage for Node.js
const storage = new Map();
global.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
  get length() { return storage.size; },
  key: (i) => [...storage.keys()][i] ?? null
};

// Import after mocking localStorage
import('../src/config/storage.js').then(({
  STORAGE_VERSION,
  STORAGE_KEYS,
  migrateStorage,
  getItem,
  getJSON,
  setJSON,
  clearAll
}) => {
  console.log('\n\x1b[1mStorage Migration Test\x1b[0m');
  console.log('═'.repeat(50));

  let passed = 0;
  let failed = 0;

  function test(name, condition) {
    if (condition) {
      console.log(`\x1b[32m[PASS]\x1b[0m ${name}`);
      passed++;
    } else {
      console.log(`\x1b[31m[FAIL]\x1b[0m ${name}`);
      failed++;
    }
  }

  // --- Test 1: Fresh install (no migration needed after first run) ---
  console.log('\n--- Fresh Install ---');
  storage.clear();
  
  const didMigrate1 = migrateStorage();
  test('Fresh install runs migration', didMigrate1 === true);
  test('Version set to current', getItem(STORAGE_KEYS.VERSION) === String(STORAGE_VERSION));
  
  const didMigrate2 = migrateStorage();
  test('Second run skips migration', didMigrate2 === false);

  // --- Test 2: Legacy data migration ---
  console.log('\n--- Legacy Data Migration ---');
  storage.clear();
  
  // Set up legacy data (pre-vero_ prefix)
  localStorage.setItem('audioMetersCollapsed', JSON.stringify(['ppm', 'correlation']));
  localStorage.setItem('audioMetersTheme', 'dark');
  localStorage.setItem('audioMetersRefLevel', '-18');
  
  migrateStorage();
  
  test('Legacy collapsed meters migrated', 
    getItem(STORAGE_KEYS.COLLAPSED_METERS) === JSON.stringify(['ppm', 'correlation']));
  test('Legacy theme migrated', 
    getItem(STORAGE_KEYS.THEME) === 'dark');
  test('Legacy ref level migrated', 
    getItem(STORAGE_KEYS.REFERENCE_LEVEL) === '-18');

  // --- Test 3: Existing v1 data preserved ---
  console.log('\n--- Existing Data Preservation ---');
  storage.clear();
  
  // Set up existing v1 data
  localStorage.setItem(STORAGE_KEYS.VERSION, '1');
  localStorage.setItem(STORAGE_KEYS.COLLAPSED_METERS, JSON.stringify(['r128', 'xy']));
  localStorage.setItem(STORAGE_KEYS.REFERENCE_LEVEL, '-23');
  
  const testCalibration = {
    version: 1,
    profiles: {
      'device-123': {
        id: 'profile-abc',
        deviceId: 'device-123',
        deviceLabel: 'Test Device',
        trimOffset: -2.5,
        calibratedAt: Date.now()
      }
    }
  };
  setJSON(STORAGE_KEYS.CALIBRATION_PROFILES, testCalibration);
  
  // Run migration (should be no-op for v1)
  const didMigrate3 = migrateStorage();
  
  test('No migration for current version', didMigrate3 === false);
  test('Collapsed meters preserved', 
    getItem(STORAGE_KEYS.COLLAPSED_METERS) === JSON.stringify(['r128', 'xy']));
  test('Reference level preserved', 
    getItem(STORAGE_KEYS.REFERENCE_LEVEL) === '-23');
  
  const restoredCalibration = getJSON(STORAGE_KEYS.CALIBRATION_PROFILES);
  test('Calibration profiles preserved', 
    restoredCalibration?.profiles?.['device-123']?.trimOffset === -2.5);
  test('Calibration device label preserved',
    restoredCalibration?.profiles?.['device-123']?.deviceLabel === 'Test Device');

  // --- Test 4: clearAll only removes vero_ keys ---
  console.log('\n--- Clear All Isolation ---');
  storage.clear();
  
  localStorage.setItem(STORAGE_KEYS.VERSION, '1');
  localStorage.setItem(STORAGE_KEYS.THEME, 'dark');
  localStorage.setItem('other_app_key', 'should-survive');
  
  clearAll();
  
  test('VERO keys cleared', getItem(STORAGE_KEYS.VERSION) === null);
  test('Other app keys preserved', localStorage.getItem('other_app_key') === 'should-survive');

  // --- Summary ---
  console.log('\n' + '═'.repeat(50));
  console.log(`Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
  console.log('═'.repeat(50) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}).catch(err => {
  console.error('Test failed to load:', err);
  process.exit(1);
});
