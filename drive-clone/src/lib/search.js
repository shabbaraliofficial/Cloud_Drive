export const DEFAULT_ADVANCED_SEARCH_FILTERS = Object.freeze({
  includesWords: '',
  type: 'any',
  owner: 'anyone',
  location: 'anywhere',
  dateModified: 'any_time',
  inBin: false,
  starred: false,
  encrypted: false,
})

export const DEFAULT_ADVANCED_SEARCH_FORM_VALUES = Object.freeze({
  name: '',
  ...DEFAULT_ADVANCED_SEARCH_FILTERS,
})

export function createAdvancedSearchFilters(overrides = {}) {
  return {
    ...DEFAULT_ADVANCED_SEARCH_FILTERS,
    ...overrides,
  }
}

export function createAdvancedSearchFormValues(overrides = {}) {
  return {
    ...DEFAULT_ADVANCED_SEARCH_FORM_VALUES,
    ...overrides,
  }
}

export function hasAdvancedSearchFilters(filters = {}) {
  const normalized = createAdvancedSearchFilters(filters)
  return Boolean(
    normalized.includesWords.trim()
      || normalized.type !== 'any'
      || normalized.owner !== 'anyone'
      || normalized.location !== 'anywhere'
      || normalized.dateModified !== 'any_time'
      || normalized.inBin
      || normalized.starred
      || normalized.encrypted
  )
}

export function buildSearchRequestParams(searchValue = '', filters = {}) {
  const normalized = createAdvancedSearchFilters(filters)
  const params = {}
  const trimmedName = String(searchValue || '').trim()

  if (trimmedName) params.name = trimmedName
  if (normalized.includesWords.trim()) params.includes_words = normalized.includesWords.trim()
  if (normalized.type && !['any', 'all'].includes(normalized.type)) params.type = normalized.type
  if (normalized.owner && normalized.owner !== 'anyone') params.owner = normalized.owner
  if (normalized.location && normalized.location !== 'anywhere') params.location = normalized.location
  if (normalized.dateModified && normalized.dateModified !== 'any_time') params.date = normalized.dateModified
  if (normalized.inBin) params.is_deleted = true
  if (normalized.starred) params.is_starred = true
  if (normalized.encrypted) params.encrypted = true

  return params
}
