/**
 * Calibration Profile Storage Test
 * Tests profile CRUD, activation, persistence
 */

// Mock localStorage and crypto
const storage = new Map();
global.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
  get length() { return storage.size; },
  key: (i) => [...storage.keys()][i] ?? null
};

// crypto.randomUUID is available in Node.js 19+

import('../src/calibration/calibration-engine.js').then((engine) => {
  const {
    getCalibrationProfiles,
    saveCalibrationProfile,
    getProfileForDevice,
    getProfilesForDevice,
    setActiveProfile,
    deactivateProfile,
    deleteCalibrationProfile,
    getProfileSummaries,
    generateProfileName,
    getUniqueProfileName,
    exportProfilesToJSON,
    importProfilesFromJSON,
    REFERENCE_STANDARDS,
    CALIBRATION_TONE
  } = engine;

  console.log('\n\x1b[1mCalibration Profile Tests\x1b[0m');
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

  // --- Test: Constants ---
  console.log('\n--- Reference Standards ---');
  test('EBU R128 target is -23 LUFS', REFERENCE_STANDARDS['ebu-23'].targetLufs === -23);
  test('ATSC A/85 target is -24 LUFS', REFERENCE_STANDARDS['atsc-24'].targetLufs === -24);
  test('Streaming target is -16 LUFS', REFERENCE_STANDARDS['streaming-16'].targetLufs === -16);
  test('Calibration tone is 1 kHz', CALIBRATION_TONE.frequency === 1000);
  test('Calibration tone level is -18 dBFS', CALIBRATION_TONE.level === -18);

  // --- Test: Empty Storage ---
  console.log('\n--- Empty Storage ---');
  storage.clear();

  const empty = getCalibrationProfiles();
  test('Empty storage returns version', empty.version === 2);
  test('Empty storage returns empty profiles', Object.keys(empty.profiles).length === 0);
  test('No profile for unknown device', getProfileForDevice('unknown') === null);

  // --- Test: Save and Retrieve ---
  console.log('\n--- Save and Retrieve ---');
  storage.clear();

  const profile1 = {
    id: 'profile-1',
    deviceId: 'browser',
    deviceLabel: 'System Audio',
    profileName: 'Test Profile 1',
    referenceStandard: 'ebu-23',
    targetLufs: -23,
    trimOffset: -2.5,
    measuredLufs: -20.5,
    measuredTp: -8.2,
    toneFrequency: 1000,
    toneLevel: -18,
    method: 'auto',
    calibratedAt: Date.now(),
    duration: 30000,
    confidence: 95
  };

  saveCalibrationProfile(profile1);

  const retrieved = getProfileForDevice('browser');
  test('Profile saved and retrieved', retrieved !== null);
  test('Profile ID matches', retrieved?.id === 'profile-1');
  test('Profile trim offset preserved', retrieved?.trimOffset === -2.5);
  test('Profile is active by default', retrieved?.isActive === true);
  test('Profile appears in summaries', getProfileSummaries().length === 1);

  // --- Test: Multiple Profiles per Device ---
  console.log('\n--- Multiple Profiles per Device ---');

  const profile2 = {
    ...profile1,
    id: 'profile-2',
    profileName: 'Test Profile 2',
    trimOffset: -1.0,
    calibratedAt: Date.now() + 1000
  };

  saveCalibrationProfile(profile2);

  const allForBrowser = getProfilesForDevice('browser');
  test('Two profiles for browser device', allForBrowser.length === 2);
  test('Newer profile listed first', allForBrowser[0].id === 'profile-2');

  const active = getProfileForDevice('browser');
  test('New profile becomes active', active?.id === 'profile-2');
  test('Old profile deactivated', allForBrowser.find(p => p.id === 'profile-1')?.isActive === false);

  // --- Test: Activate Profile ---
  console.log('\n--- Activate Profile ---');

  setActiveProfile('profile-1');
  const reactivated = getProfileForDevice('browser');
  test('Can reactivate old profile', reactivated?.id === 'profile-1');

  const summaries = getProfileSummaries();
  const profile1Summary = summaries.find(p => p.id === 'profile-1');
  const profile2Summary = summaries.find(p => p.id === 'profile-2');
  test('Profile 1 now active', profile1Summary?.isActive === true);
  test('Profile 2 now inactive', profile2Summary?.isActive === false);

  // --- Test: Deactivate Profile ---
  console.log('\n--- Deactivate Profile ---');

  const deactivated = deactivateProfile('profile-1');
  test('Deactivate returns true', deactivated === true);
  test('No active profile for browser', getProfileForDevice('browser') === null);
  test('Deactivate again returns false', deactivateProfile('profile-1') === false);

  // --- Test: Delete Profile ---
  console.log('\n--- Delete Profile ---');

  deleteCalibrationProfile('profile-2');
  test('Profile deleted', getProfilesForDevice('browser').length === 1);
  test('Correct profile remains', getProfilesForDevice('browser')[0].id === 'profile-1');

  // --- Test: Multiple Devices ---
  console.log('\n--- Multiple Devices ---');
  storage.clear();

  const browserProfile = { ...profile1, id: 'bp', deviceId: 'browser', deviceLabel: 'Browser' };
  const externalProfile = { ...profile1, id: 'ep', deviceId: 'ext-123', deviceLabel: 'USB Mic' };

  saveCalibrationProfile(browserProfile);
  saveCalibrationProfile(externalProfile);

  test('Browser profile active', getProfileForDevice('browser')?.id === 'bp');
  test('External profile active', getProfileForDevice('ext-123')?.id === 'ep');
  test('Two profiles total', getProfileSummaries().length === 2);

  // --- Test: Profile Name Generation ---
  console.log('\n--- Profile Name Generation ---');

  const name = generateProfileName('Studio A');
  test('Generated name contains device label', name.includes('Studio A'));
  test('Generated name contains date', /\d{4}-\d{2}-\d{2}/.test(name));

  // --- Test: Unique Profile Names ---
  console.log('\n--- Unique Profile Names ---');
  storage.clear();

  const p1 = { ...profile1, id: 'p1', profileName: 'Borås Hockey' };
  saveCalibrationProfile(p1);

  test('First name unchanged', getUniqueProfileName('Borås Hockey') === 'Borås Hockey 2');

  const p2 = { ...profile1, id: 'p2', profileName: 'Borås Hockey 2' };
  saveCalibrationProfile(p2);

  test('Increments for duplicates', getUniqueProfileName('Borås Hockey') === 'Borås Hockey 3');
  test('New name stays unchanged', getUniqueProfileName('Stockholm Arena') === 'Stockholm Arena');

  // --- Test: Export/Import ---
  console.log('\n--- Export/Import ---');
  storage.clear();

  saveCalibrationProfile({ ...profile1, id: 'export-test', profileName: 'Export Test' });

  const json = exportProfilesToJSON();
  const parsed = JSON.parse(json);

  test('Export contains application', parsed.application === 'TSG VERO-BAAMBI');
  test('Export contains version', parsed.schemaVersion === 2);
  test('Export contains profile', parsed.profiles['export-test'] !== undefined);

  storage.clear();

  const importResult = importProfilesFromJSON(json);
  test('Import succeeds', importResult.imported === 1);
  test('Import no errors', importResult.errors.length === 0);
  test('Imported profile exists', getProfilesForDevice('browser').length === 1);

  // --- Test: Import Validation ---
  console.log('\n--- Import Validation ---');

  const badImport1 = importProfilesFromJSON('not json');
  test('Rejects invalid JSON', badImport1.errors.length > 0);

  const badImport2 = importProfilesFromJSON('{"profiles": "not object"}');
  test('Rejects invalid format', badImport2.errors.length > 0);

  // --- Test: V1 to V2 Migration ---
  console.log('\n--- V1 to V2 Migration ---');
  storage.clear();

  // Simulate v1 storage (keyed by deviceId)
  const v1Data = {
    version: 1,
    profiles: {
      'browser': {
        deviceId: 'browser',
        deviceLabel: 'Browser Audio',
        profileName: 'Legacy Profile',
        trimOffset: -3.0,
        calibratedAt: Date.now()
      }
    }
  };
  localStorage.setItem('vero_calibration_profiles', JSON.stringify(v1Data));

  const migrated = getCalibrationProfiles();
  test('Migrated to v2', migrated.version === 2);

  const migratedProfile = Object.values(migrated.profiles)[0];
  test('Migrated profile has UUID', migratedProfile?.id !== undefined);
  test('Migrated profile is active', migratedProfile?.isActive === true);
  test('Migrated profile preserves trim', migratedProfile?.trimOffset === -3.0);

  // --- Summary ---
  console.log('\n' + '═'.repeat(50));
  console.log(`Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
  console.log('═'.repeat(50) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}).catch(err => {
  console.error('Test failed to load:', err);
  process.exit(1);
});
