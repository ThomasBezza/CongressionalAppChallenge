export const norms = 'Give each other time and let each person finish what they’re saying. Don’t finish someone’s words or coach their speech unless they ask you to. Either of you can pause or leave at any point, and typing or pointing counts just as much as speaking.';

const cafeBriefs = {
  customer: 'Pick your order privately, in your head or on your own paper. The app does not ask for your intended order. When the conversation starts, ask for what you want, answer the cashier’s questions, and correct anything they get wrong. If they share a ticket, you can review it together or skip it. You don’t have to sound fluent to do this well.',
  cashier: 'Greet the customer and ask what they’d like. Respond to what they actually say rather than what you expect. If something is missing, like the size, ask about it. You can write what you understood on the order ticket and share it for an optional review. Read the order back and give them all the time they need.',
  host: 'Find two people who want to practice and send them the invitation. Let them in, give one the customer role and the other the cashier role, and explain how to ask for time, pause, or leave. Start once both are ready, then let them talk without stepping in.'
};

// Content is shared by the browser and the server's scene-specific validation.
// Customer/cashier remain internal permission roles in every scene.
export const scenarios = {
  cafe: {
    id: 'cafe', title: 'Ordering at a café', description: 'Order a drink and clarify what the cashier heard.',
    activeTitle: 'Ordering at the café', roles: { customer: 'Customer', cashier: 'Cashier', host: 'Host' },
    briefs: cafeBriefs,
    preparation: {
      customer: 'Decide what you’d like from the menu below. Ask for it, answer any questions, and correct anything that comes back wrong.',
      cashier: 'Greet the customer and ask what they’d like. Ask about anything they leave out, like the size, then read the order back so they can correct it.'
    },
    referenceTitle: 'Tea & Coffee', referenceName: 'menu',
    referenceNote: 'This café is made up for practice. Keep your order in your head or on your own paper.',
    facts: [
      { label: 'Drink', value: 'Iced tea or coffee' }, { label: 'Size', value: 'Small or large' },
      { label: 'Ice', value: 'With or without' }, { label: 'To have it', value: 'Here or to go' }
    ],
    ticketTitle: 'Order ticket', ticketNoun: 'ticket', listenerAddress: 'Your cashier',
    ticketFields: [
      { name: 'drink', label: 'Drink', options: ['Iced tea', 'Coffee'] },
      { name: 'size', label: 'Size', options: ['Small', 'Large'] },
      { name: 'ice', label: 'Ice', options: ['With ice', 'Without ice'] },
      { name: 'place', label: 'To have it', options: ['Here', 'To go'] }
    ]
  },
  booking: {
    id: 'booking', title: 'Booking a bowling lane', description: 'Call a venue and agree on a day, time and party size.',
    activeTitle: 'Calling Maple Lanes', roles: { customer: 'Caller', cashier: 'Staff member', host: 'Host' },
    briefs: {
      customer: 'Choose a day, time and number of people privately from the venue details. Call Maple Lanes to book one hour of bowling. Answer the staff member’s questions and clarify the readback. If they share a reservation slip, review it or skip it. No real booking is made, and you don’t have to sound fluent to do this well.',
      cashier: 'Answer the call as Maple Lanes staff. Ask which day, time and number of people the caller wants. Both listed times are available on both days for this practice. Listen to what they say, ask about missing details, and read the reservation back. You can write what you understood on the reservation slip and offer an optional review. Give the caller the time they need.',
      host: 'Invite two willing people and assign Caller and Staff member. This is a fictional phone booking, with both listed times available on both days. Explain the time and pause controls, start once both are ready, then let the pair clarify the reservation without stepping in.'
    },
    preparation: {
      customer: 'Choose a day, time and party size privately from the venue details. Call to book a lane, answer the staff member’s questions, and clarify the reservation they read back.',
      cashier: 'Answer as Maple Lanes staff. Ask for the day, time and number of people, then read the reservation back so the caller can confirm or correct it.'
    },
    referenceTitle: 'Maple Lanes', referenceName: 'venue details',
    referenceNote: 'A fictional venue for practice. All listed options are available. Keep your preferred reservation in your head or on paper. No real booking is made.',
    facts: [
      { label: 'Activity', value: 'One hour of bowling' }, { label: 'Day', value: 'Friday or Saturday' },
      { label: 'Time', value: '4:00 p.m. or 6:00 p.m.' }, { label: 'People', value: 'Two or four people' }
    ],
    ticketTitle: 'Reservation slip', ticketNoun: 'slip', listenerAddress: 'The staff member',
    ticketFields: [
      { name: 'day', label: 'Day', options: ['Friday', 'Saturday'] },
      { name: 'time', label: 'Time', options: ['4:00 p.m.', '6:00 p.m.'] },
      { name: 'people', label: 'People', options: ['Two people', 'Four people'] }
    ]
  }
};
