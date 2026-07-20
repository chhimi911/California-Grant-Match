(function exposeGrantMatching(root) {
  function grantMatchesFilters(grant, filters) {
    const applicantMatches = grant.applicantTypes.includes(filters.applicant);
    const categoryMatches = !filters.category || grant.categories.includes(filters.category);
    const countyMatches =
      !filters.county ||
      grant.counties.includes('Statewide') ||
      grant.counties.includes(filters.county);

    return applicantMatches && categoryMatches && countyMatches;
  }

  function normalizeDisplayAmounts(amountMin, amountMax) {
    const placeholderMinimum =
      amountMin != null && amountMax != null && amountMin <= 1 && amountMax >= 1_000;

    return {
      amountMin: placeholderMinimum ? null : amountMin,
      amountMax,
    };
  }

  const api = { grantMatchesFilters, normalizeDisplayAmounts };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GrantMatching = api;
})(typeof window !== 'undefined' ? window : globalThis);
