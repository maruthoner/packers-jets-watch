// One entry per game. Every cycle checks each game that has not kicked off yet.
//
//   quantity     seats that must be sold together
//   priceMax     highest all-in price per ticket that counts as a match
//   sections     optional: only these section numbers (omit for any section)
//   rowMax       optional: only rows 1..rowMax (omit for any row)
//   closest      how many near-misses to show on the page when nothing fits
//   preferred    optional [{ id, label, sections, rowMax?, rowMin?, priceMax?, alerts? }]
//                ordered: a seat belongs to the first list it fits and appears only there;
//                the list marked `alerts` is the only one that sends email
//   otherSections  false: show only the lists above; seats elsewhere are not listed at all

// Ruth, Sep 19: the upper/mezzanine sections, and the 100-level ones kept separate
const UPPER_SECTIONS = [337, 338, 339, 340, 237, 239, 240];
const HUNDRED_SECTIONS = [137, 139, 140];

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
    closest: 3,
    preferred: [               // Ruth, Sep 19: Row 1 and Section 100s email; Any row is page only
      { id: 'row1', label: 'Row 1',
        sections: UPPER_SECTIONS, rowMax: 1, priceMax: 150, alerts: true },
      { id: 'hundreds', label: 'Section 100s',
        sections: HUNDRED_SECTIONS, rowMax: 20, priceMax: 200, alerts: true },
      { id: 'rows', label: 'Any row',
        sections: UPPER_SECTIONS, rowMin: 2, priceMax: 150 },
    ],
    otherSections: false,      // Ruth, Sep 18: these two lists only
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
    closest: 3,
  },
};
