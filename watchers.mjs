// One entry per game. Every cycle checks each game that has not kicked off yet.
//
//   quantity     seats that must be sold together
//   priceMax     highest all-in price per ticket that counts as a match
//   sections     optional: only these section numbers (omit for any section)
//   rowMax       optional: only rows 1..rowMax (omit for any row)
//   assignedOnly true: listings with no seat (standing room, 'TBD') never count
//   venueMap     optional venue id; draws a section map at the foot of the page
//   closest      how many near-misses to show on the page when nothing fits
//   preferred    optional [{ id, label, sections, rowMax?, rowMin?, priceMax?, alerts? }]
//                ordered: a seat belongs to the first list it fits and appears only there;
//                every list marked `alerts` emails, each in its own issue
//   otherSections  false: show only the lists above; seats elsewhere are not listed at all
//
// A game is dropped from here once it has been played. The Jets watch (Sep 20) ended
// with its final page kept at docs/jets/index.html.

export const WATCHERS = {
  falcons: {
    id: 'falcons',
    title: 'Falcons at Packers',
    subtitle: 'Thu Sep 24 · 7:15 PM · Lambeau Field',
    url: 'https://ticketwhiz.com/events/green-bay-packers-vs-atlanta-falcons-tickets-09-24-2026-3657af43f0f449d48f9085aa0d9a542a',
    kickoff: '2026-09-24T19:15:00-05:00', // Green Bay is Central time
    alertLabel: 'Falcons',
    outDir: 'docs',           // the main page since the Jets game ended (Ruth, Sep 20)
    quantity: 3,
    priceMax: 150,             // any section, any row
    assignedOnly: true,        // seats only — standing room is not a match (Ruth, Sep 20)
    venueMap: 'lambeau',       // section map at the foot of the page
    closest: 3,
  },
};
