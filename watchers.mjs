// One entry per game. Every cycle checks each game that has not kicked off yet.
//
//   quantity     seats that must be sold together
//   priceMax     highest all-in price per ticket that counts as a match
//   sections     optional: only these section numbers (omit for any section)
//   rowMax       optional: only rows 1..rowMax (omit for any row)
//   minListings  sanity floor: fewer listings than this means the read is not trustworthy
//   closest      how many near-misses to show on the page when nothing fits
export const WATCHERS = {
  jets: {
    id: 'jets',
    title: 'Packers at Jets',
    subtitle: 'Sun Sep 20 · 1:00 PM · MetLife Stadium',
    url: 'https://ticketwhiz.com/events/new-york-jets-vs-green-bay-packers-tickets-09-20-2026-9c5760f98b8648c2a1c13572c2611882',
    kickoff: '2026-09-20T13:00:00-04:00',
    alertLabel: 'Jets',
    outDir: 'docs',
    quantity: 2,
    priceMax: 100,             // any section, any row (Ruth, Sep 14)
    minListings: 8000,         // 2-together market has run ~8,700-13,500
    closest: 3,
  },

  falcons: {
    id: 'falcons',
    title: 'Falcons at Packers',
    subtitle: 'Thu Sep 24 · 7:15 PM · Lambeau Field',
    url: 'https://ticketwhiz.com/events/green-bay-packers-vs-atlanta-falcons-tickets-09-24-2026-3657af43f0f449d48f9085aa0d9a542a',
    kickoff: '2026-09-24T19:15:00-05:00', // Green Bay is Central time
    alertLabel: 'Falcons',
    outDir: 'docs/falcons',
    quantity: 3,
    priceMax: 130,             // any section, any row
    minListings: 250,          // 3-together market was 658-669 on Sep 14
    closest: 3,
  },
};
