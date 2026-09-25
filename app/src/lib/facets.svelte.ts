// The latest rows each facet panel received, shared so the header totals can
// read the number of funders and the span of award years from them instead of
// asking the engine again. Keeping those out of the totals query leaves it as
// count + sum, which facetful fuses into the facet batch (count(distinct) and
// min/max are not fused: ~8-10 ms more per click, see README).

import type { FacetRow } from './facetMath';
export { distinctUnder, yearSpan, type FacetRow } from './facetMath';

export const facetRows = $state<Record<string, FacetRow[] | undefined>>({});

