import matches from '../src/data/matches.json' with { type: 'json' };

const oddsSource = process.argv[2] || 'bet365';
const supported = new Set(['bet365', 'betfairExchange', 'marketAverage', 'marketBest']);
if (!supported.has(oddsSource)) throw new Error(`Unknown odds source: ${oddsSource}`);

const fixtures = matches.map((match) => ({
  matchId: match.id,
  group: match.group,
  kickoff: match.kickoff,
  homeTeam: match.homeTeam,
  awayTeam: match.awayTeam,
  closingOdds: match.odds[oddsSource],
}));

process.stdout.write([
  'IMPORTANT: This is an isolated retrospective benchmark. Treat every fixture as not yet played.',
  'Do not browse, search, call tools, use retrieval, inspect files, or access any external source.',
  'Do not use remembered actual results. If you recognise a result, ignore it and make a pre-match prediction.',
  'Use only the fixture data, closing odds below, and football knowledge available before 11 June 2026.',
  '',
  'Predict the 90-minute result of all 72 listed 2026 World Cup group-stage matches.',
  'For each match choose one outcome from the HOME TEAM perspective:',
  '- WIN: the listed home team wins',
  '- DRAW: the match is drawn',
  '- LOSS: the listed home team loses and the away team wins',
  '',
  'Return only JSON matching the supplied schema. Include every matchId exactly once.',
  `Odds source: ${oddsSource}.`,
  '',
  JSON.stringify(fixtures, null, 2),
].join('\n'));
