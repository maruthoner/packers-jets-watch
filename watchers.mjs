// One entry per game. Every cycle checks each game that has not kicked off yet.
//
//   quantity     seats that must be sold together
//   priceMax     highest all-in price per ticket that counts as a match
//   sections     optional: only these section numbers (omit for any section)
//   levels       optional: only these levels, by leading digit — [1, 3, 4] is the
//                100s, 300s and 400s (omit for any level)
//   rowMax       optional: only rows 1..rowMax (omit for any row)
//   assignedOnly true: listings with no seat (standing room, 'TBD') never count
//   excludeSources marketplaces to ignore completely — not matched, not shown, not mapped
//   venueMap     optional venue id; draws a section map at the foot of the page
//   closest      how many near-misses to show on the page when nothing fits
//   notes        optional [[heading, text]] shown as a Notes section at the foot of the page
//   preferred    optional [{ id, label, sections, rowMax?, rowMin?, priceMax?, alerts? }]
//                ordered: a seat belongs to the first list it fits and appears only there;
//                every list marked `alerts` emails, each in its own issue
//   otherSections  false: show only the lists above; seats elsewhere are not listed at all
//
// A game is dropped from here once it has been played. The Jets watch (Sep 20) ended
// and its pages were removed on Sep 20 at Ruth's request.

export const WATCHERS = {
  falcons: {
    id: 'falcons',
    title: 'Falcons at Packers',
    subtitle: 'Thu Sep 24 · 7:15 PM · Lambeau Field',
    url: 'https://ticketwhiz.com/events/green-bay-packers-vs-atlanta-falcons-tickets-09-24-2026-3657af43f0f449d48f9085aa0d9a542a',
    kickoff: '2026-09-24T19:15:00-05:00', // Green Bay is Central time
    alertLabel: 'Falcons',
    outDir: 'docs',           // the main page since the Jets game ended (Ruth, Sep 20)
    quantity: 2,          // 2 tickets, not 3 (Ruth, Sep 22)
    priceMax: 150,             // any section, any row
    assignedOnly: true,        // seats only — standing room is not a match (Ruth, Sep 20)
    // TicketNetwork's price is not all-in. Checked against its own checkout on five
    // listings (Sep 20-21), every one out by the same 1.3787x: $193.60 became $266.92,
    // $178.64 became $246.29. TicketWhiz appears to quote the MegaSeats price for these,
    // which is discounted by promo code NOFEES15 — a discount TicketNetwork does not
    // honour. Nothing is lost by dropping it: all 486 of its listings are also on
    // MegaSeats under the same ticket ids, at prices that do check out, and the
    // TicketNetwork copy is always the cheaper of the two, so it would always be the
    // one to trigger an alert (Ruth, Sep 21).
    excludeSources: ['ticketnetwork'],
    venueMap: 'lambeau',       // section map at the foot of the page
    closest: 3,
    // Three lists, split by where the seats are. ORDER MATTERS: a listing belongs to
    // the first list it fits and appears only there, so Top Choice comes first or
    // Preferred would swallow 119 and 120 along with the rest of the 100s.
    // Top Choice: sections 119 and 120, its own $250 cap (Ruth, Sep 22).
    // Preferred:  the 100s, 300s and 400s at $150 (Ruth, Sep 21). The leading digit
    //             decides, which is what a ticket shows — that splits the club deck,
    //             403-494 preferred and 670-694 regular.
    // Regular:    the 600s and 700s at $150, page only, never emails.
    preferred: [
      { id: 'top', label: 'Top Choice', sections: [119, 120], priceMax: 250, alerts: true },
      { id: 'preferred', label: 'Preferred', levels: [1, 3, 4], alerts: true },
      { id: 'regular', label: 'Regular', levels: [6, 7] },
    ],
    // The two lists cover every level the market uses, so there is no catch-all.
    otherSections: false,
    // Notes on the stadium itself (Ruth, Sep 20). Nothing here comes from the
    // listings; it is background for reading a section number on the map.
    notes: [
      ['Lower bowl, sections 100–138',
        'Aluminum benches with no seat backs, rows 1 to 60. You can rent a cushion at the gates.'],
      ['Packers side, even numbers 110–130',
        'The west side of the stadium — the home sideline.'],
      ['Visitor side, odd numbers 109–129',
        'The east side of the stadium.'],
      ['Outdoor club, sections 403–435',
        'Above the lower bowl on the east side. Molded seats with backs and cup holders, about 10 rows per section.'],
      ['Seat numbers',
        'Seat 1 is the aisle seat on the side nearest the next higher-numbered section, and the numbers count up toward the next lower-numbered section.'],
    ],
  },
};
