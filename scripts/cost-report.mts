// Req 23 / AC 23: AI cost per brand per week, and whether it is under the cap. Read-only, no AI calls.
// Run: node --env-file=.env.local --import tsx scripts/cost-report.mts [brandId] [fromWeekStart]
// Reads whichever backend DATA_BACKEND selects (the mock database in .data/ by default).

import { costReport, formatCostReport } from '@/lib/usage/report';

const [brandId, fromWeekStart] = process.argv.slice(2);
console.log(formatCostReport(await costReport({ brandId, fromWeekStart })));
process.exit(0);
