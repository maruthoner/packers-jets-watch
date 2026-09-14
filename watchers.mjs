// Each entry is one game being watched. The workflow runs every entry each cycle
// and skips any whose game has already kicked off.
export const WATCHERS = {
  jets: {
    id: 'jets',
    title: 'Packers at Jets',
    subtitle: 'Sun Sep 20 · 1:00 PM · MetLife Stadium',
    url: 'https://ticketwhiz.com/events/new-york-jets-vs-green-bay-packers-tickets-09-20-2026-9c5760f98b8648c2a1c13572c2611882',
    kickoff: '2026-09-20T13:00:00-04:00',
    quantity: 2,
    minListings: 8000,          // 2-together market has run ~8,700-13,500
    outDir: 'docs',
    resultFile: 'result.json',
    alertLabel: 'Jets',
    targets: [
      { id: 'A', label: 'Lower bowl · Packers sideline', secs: [135,137,139,140,142], rowMax: 20, priceMax: 360, near: { rowMax: 25, priceMax: 430 } },
      { id: 'B', label: 'Upper deck · Packers sideline', secs: [337,338,339,340],     rowMax: 1,  priceMax: 250, near: { rowMax: 4,  priceMax: 300 } },
      { id: 'C', label: 'Upper deck · Jets sideline',    secs: [311,312,313,314,315,316], rowMax: 1, priceMax: 149.99, near: { rowMax: 4, priceMax: 180 } },
    ],
  },

  falcons: {
    id: 'falcons',
    title: 'Falcons at Packers',
    subtitle: 'Thu Sep 24 · 7:15 PM · Lambeau Field',
    url: 'https://ticketwhiz.com/events/green-bay-packers-vs-atlanta-falcons-tickets-09-24-2026-3657af43f0f449d48f9085aa0d9a542a',
    kickoff: '2026-09-24T19:15:00-05:00',   // Green Bay is Central time
    quantity: 3,
    minListings: 250,           // 3-together market settled at 658 on Sep 14; floor allows for thinning near kickoff
    outDir: 'docs/falcons',
    resultFile: 'result-falcons.json',
    alertLabel: 'Falcons',
    anySeat: true,              // any section, any row — only price and quantity matter
    priceMax: 130,
    closest: 3,                 // show the cheapest few on the page so the gap to $130 is visible
  },
};
