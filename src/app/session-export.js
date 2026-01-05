/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TSG Suite – broadcast tools for alignment, metering, and signal verification
 * Maintained by David Thåst  ·  https://github.com/FiLORUX
 *
 * Built with the assumption that behaviour should be predictable,
 * output should be verifiable, and silence should mean silence
 *
 * david@thast.se  ·  +46 700 30 30 60
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EBU R128 SESSION EXPORT
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * Export accumulated loudness measurements in standards-compliant formats.
 * Supports sessions of any duration (not limited by radar history).
 *
 * FORMATS
 * ───────
 *   - JSON: Human-readable, follows EBU R128 terminology
 *   - XML:  ADM-compliant (ITU-R BS.2076 / EBU Tech 3364)
 *
 * DATA SOURCES
 * ────────────
 *   - Integrated loudness: From LUFS meter (gated, cumulative)
 *   - Loudness Range (LRA): From LUFS meter (EBU Tech 3342)
 *   - True Peak Max: From meterState (cumulative)
 *   - Session duration: From meterState (excluding paused time)
 *
 * @module app/session-export
 * @see ITU-R BS.2076 (Audio Definition Model)
 * @see EBU Tech 3364 (ADM Metadata Specification)
 * @see EBU R128 (Loudness normalisation)
 * @see EBU Tech 3341 (Loudness Metering)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { meterState, getElapsedSeconds } from './meter-state.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Export format version for JSON */
const JSON_FORMAT_VERSION = '1.0';

/** ADM schema version */
const ADM_VERSION = 'ITU-R_BS.2076-2';

// ─────────────────────────────────────────────────────────────────────────────
// SESSION DATA COLLECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get accumulated session data from LUFS meter and meterState.
 *
 * This function collects data from the continuous accumulators,
 * NOT from the limited radar history buffer.
 *
 * @param {Object} lufsMeter - LUFS meter instance with getState() method
 * @param {number} targetLufs - Target loudness (e.g., -23 LUFS)
 * @returns {SessionData} Session data object
 */
export function getSessionData(lufsMeter, targetLufs = -23) {
  const lufsState = lufsMeter?.getState() ?? {};

  const startTime = new Date(meterState.sessionStartWallTime);
  const endTime = new Date();
  const durationSeconds = getElapsedSeconds();

  // Get cumulative True Peak max (both channels)
  const tpMax = Math.max(
    meterState.tpMaxL ?? -Infinity,
    meterState.tpMaxR ?? -Infinity
  );

  // Get current integrated and LRA from LUFS meter
  const integrated = lufsState.integrated ?? null;
  const lra = lufsState.lra ?? null;
  const momentary = lufsState.momentary ?? null;
  const shortTerm = lufsState.shortTerm ?? null;

  return {
    valid: durationSeconds > 0 && isFinite(integrated),
    startTime,
    endTime,
    durationSeconds,
    durationFormatted: formatDuration(durationSeconds),
    integrated,
    lra,
    momentary,
    shortTerm,
    truePeakMax: isFinite(tpMax) ? tpMax : null,
    truePeakMaxL: isFinite(meterState.tpMaxL) ? meterState.tpMaxL : null,
    truePeakMaxR: isFinite(meterState.tpMaxR) ? meterState.tpMaxR : null,
    target: targetLufs,
    paused: meterState.measurementPaused,
    totalPausedSeconds: meterState.totalPausedMs / 1000
  };
}

/**
 * @typedef {Object} SessionData
 * @property {boolean} valid - Whether session has valid data
 * @property {Date} startTime - Session start time (wall clock)
 * @property {Date} endTime - Session end time (wall clock)
 * @property {number} durationSeconds - Active duration excluding pauses
 * @property {string} durationFormatted - Human-readable duration
 * @property {number|null} integrated - Integrated loudness in LUFS
 * @property {number|null} lra - Loudness Range in LU
 * @property {number|null} momentary - Current momentary loudness in LUFS
 * @property {number|null} shortTerm - Current short-term loudness in LUFS
 * @property {number|null} truePeakMax - Maximum True Peak in dBTP
 * @property {number|null} truePeakMaxL - Maximum True Peak left channel
 * @property {number|null} truePeakMaxR - Maximum True Peak right channel
 * @property {number} target - Target loudness in LUFS
 * @property {boolean} paused - Whether measurement is currently paused
 * @property {number} totalPausedSeconds - Total paused time in seconds
 */

// ─────────────────────────────────────────────────────────────────────────────
// JSON EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate JSON export following EBU R128 terminology.
 *
 * @param {SessionData} data - Session data from getSessionData()
 * @returns {string} JSON string (pretty-printed)
 */
export function generateJSON(data) {
  if (!data.valid) {
    return JSON.stringify({ error: 'No valid session data' }, null, 2);
  }

  const exportData = {
    format: 'EBU R128 Session Report',
    version: JSON_FORMAT_VERSION,
    generated: new Date().toISOString(),
    generator: 'TSG VERO-BAAMBI',

    session: {
      start: data.startTime.toISOString(),
      end: data.endTime.toISOString(),
      duration: data.durationFormatted,
      durationSeconds: Math.round(data.durationSeconds),
      pausedSeconds: Math.round(data.totalPausedSeconds)
    },

    loudness: {
      integrated: round2(data.integrated),
      integratedUnit: 'LUFS',
      range: round2(data.lra),
      rangeUnit: 'LU',
      target: data.target,
      targetUnit: 'LUFS',
      deviation: round2(data.integrated - data.target),
      deviationUnit: 'LU'
    },

    truePeak: {
      max: round2(data.truePeakMax),
      maxLeft: round2(data.truePeakMaxL),
      maxRight: round2(data.truePeakMaxR),
      unit: 'dBTP'
    },

    compliance: {
      integratedWithinTolerance: Math.abs(data.integrated - data.target) <= 1.0,
      truePeakBelowLimit: data.truePeakMax <= -1.0,
      toleranceUsed: '±1.0 LU',
      truePeakLimit: '-1.0 dBTP'
    },

    reference: {
      standard: 'EBU R128',
      meteringSpec: 'EBU Tech 3341',
      loudnessRange: 'EBU Tech 3342',
      truePeak: 'ITU-R BS.1770-4',
      gating: 'ITU-R BS.1770-4 §5'
    }
  };

  return JSON.stringify(exportData, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// XML EXPORT (ADM-COMPLIANT)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate XML export following ITU-R BS.2076 / EBU Tech 3364 (ADM).
 *
 * The loudnessMetadata element is placed within an audioProgramme element
 * as specified in the Audio Definition Model.
 *
 * @param {SessionData} data - Session data from getSessionData()
 * @param {Object} [options] - Export options
 * @param {string} [options.programmeName='VERO-BAAMBI Session'] - Programme name
 * @param {string} [options.programmeId='APR_1001'] - ADM programme ID
 * @returns {string} XML string (pretty-printed)
 *
 * @see https://adm.ebu.io/reference/adm_elements/loudness_metadata.html
 */
export function generateXML(data, options = {}) {
  const {
    programmeName = 'VERO-BAAMBI Session',
    programmeId = 'APR_1001'
  } = options;

  if (!data.valid) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!-- No valid session data -->
<error>No valid session data available for export</error>`;
  }

  // Format values for XML (null → empty element)
  const integrated = formatXMLValue(data.integrated);
  const lra = formatXMLValue(data.lra);
  const tpMax = formatXMLValue(data.truePeakMax);
  const momentary = formatXMLValue(data.momentary);
  const shortTerm = formatXMLValue(data.shortTerm);

  // Build ADM-compliant XML
  // Reference: ITU-R BS.2076-2, EBU Tech 3364
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  EBU R128 Session Report
  Generated by TSG VERO-BAAMBI
  ${new Date().toISOString()}

  Format: ITU-R BS.2076 / EBU Tech 3364 (Audio Definition Model)
  Schema: ${ADM_VERSION}
-->
<ebuCoreMain xmlns="urn:ebu:metadata-schema:ebucore"
             xmlns:adm="urn:ebu:metadata-schema:adm"
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">

  <coreMetadata>
    <title>VERO-BAAMBI Loudness Report</title>
    <creator>TSG VERO-BAAMBI</creator>
    <date>
      <created>${data.startTime.toISOString()}</created>
      <modified>${data.endTime.toISOString()}</modified>
    </date>
    <duration>${formatDurationISO(data.durationSeconds)}</duration>

    <format>
      <audioFormat>
        <adm:audioFormatExtended>

          <adm:audioProgramme audioProgrammeID="${escapeXML(programmeId)}"
                              audioProgrammeName="${escapeXML(programmeName)}"
                              start="${formatDurationISO(0)}"
                              end="${formatDurationISO(data.durationSeconds)}">

            <adm:loudnessMetadata loudnessMethod="ITU-R BS.1770"
                                  loudnessRecType="EBU R128"
                                  loudnessCorrectionType="file">
              <adm:integratedLoudness>${integrated}</adm:integratedLoudness>
              <adm:loudnessRange>${lra}</adm:loudnessRange>
              <adm:maxTruePeak>${tpMax}</adm:maxTruePeak>
              <adm:maxMomentary>${momentary}</adm:maxMomentary>
              <adm:maxShortTerm>${shortTerm}</adm:maxShortTerm>
            </adm:loudnessMetadata>

          </adm:audioProgramme>

        </adm:audioFormatExtended>
      </audioFormat>
    </format>

  </coreMetadata>

</ebuCoreMain>`;

  return xml;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOWNLOAD FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Download session data as JSON file.
 *
 * @param {Object} lufsMeter - LUFS meter instance
 * @param {number} [targetLufs=-23] - Target loudness
 * @param {string} [filename] - Custom filename (auto-generated if omitted)
 */
export function downloadSessionJSON(lufsMeter, targetLufs = -23, filename) {
  const data = getSessionData(lufsMeter, targetLufs);
  const json = generateJSON(data);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = filename || `loudness-report-${timestamp}.json`;

  downloadFile(json, name, 'application/json');
}

/**
 * Download session data as ADM-compliant XML file.
 *
 * @param {Object} lufsMeter - LUFS meter instance
 * @param {number} [targetLufs=-23] - Target loudness
 * @param {string} [filename] - Custom filename (auto-generated if omitted)
 * @param {Object} [options] - XML export options
 */
export function downloadSessionXML(lufsMeter, targetLufs = -23, filename, options) {
  const data = getSessionData(lufsMeter, targetLufs);
  const xml = generateXML(data, options);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = filename || `loudness-report-${timestamp}.xml`;

  downloadFile(xml, name, 'application/xml');
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format duration in HH:MM:SS.
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration
 */
function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Format duration in ISO 8601 duration format (for XML).
 * @param {number} seconds - Duration in seconds
 * @returns {string} ISO 8601 duration (e.g., "PT1H30M45S")
 */
function formatDurationISO(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  let iso = 'PT';
  if (h > 0) iso += `${h}H`;
  if (m > 0) iso += `${m}M`;
  iso += `${s}S`;
  return iso;
}

/**
 * Round to 2 decimal places, return null if invalid.
 * @param {number|null} value - Value to round
 * @returns {number|null} Rounded value
 */
function round2(value) {
  if (value === null || value === undefined || !isFinite(value)) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

/**
 * Format value for XML element (null → empty string).
 * @param {number|null} value - Value to format
 * @returns {string} Formatted value
 */
function formatXMLValue(value) {
  if (value === null || value === undefined || !isFinite(value)) {
    return '';
  }
  return value.toFixed(1);
}

/**
 * Escape special characters for XML.
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeXML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Trigger browser file download.
 * @param {string} content - File content
 * @param {string} filename - Filename
 * @param {string} mimeType - MIME type
 */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}
