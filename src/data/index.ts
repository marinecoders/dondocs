/**
 * Data barrel export
 *
 * Central export point for all military data.
 * Import from '@/data' instead of individual files.
 */

// Office Codes
export {
  OFFICE_CODES,
  OFFICE_CODE_CATEGORIES,
  OFFICE_CODES_INFO,
  getOfficeCodesByCategory,
  searchOfficeCodes,
  getOfficeCode,
  type OfficeCode,
  type OfficeCodeCategory,
} from './officeCodes';

// Military Ranks
export {
  USMC_RANKS,
  NAVY_RANKS,
  ALL_SERVICE_RANKS,
  formatRank,
  type Rank,
  type RankCategory,
  type ServiceRanks,
} from './ranks';

// SSIC Codes
export {
  SSIC_CATEGORIES,
  ALL_SSIC_CODES,
  SSIC_BY_CODE,
  type SSICCode,
  type SSICCategory,
} from './ssicCodes';

// Unit Directory
export {
  UNIT_CATEGORIES,
  ALL_UNITS,
  UNIT_DATABASE_INFO,
  formatUnitAddress,
  expandUnitName,
  formatLetterhead,
  type UnitInfo,
  type UnitCategory,
} from './unitDirectory';
