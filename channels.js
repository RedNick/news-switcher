// The news channels to rotate through, in order.
//
// Each entry uses the broadcaster's YouTube *channel ID* rather than a video ID.
// YouTube replaces the video ID of a 24/7 stream from time to time, but the
// "live_stream?channel=" embed always points at whatever the channel is
// currently streaming live.
//
// To add a channel: find its ID (it starts with "UC") on the channel's
// YouTube page, under About > Share channel > Copy channel ID.
const NEWS_CHANNELS = [
  { name: "BBC News",             youtubeChannelId: "UC16niRr50-MSBwiO3YDb3RA" },
  { name: "Sky News",             youtubeChannelId: "UCoMdktPbSTixAyNGwb-UYkQ" },
  { name: "Al Jazeera English",   youtubeChannelId: "UCNye-wNBqNL5ZzHSJj3l8Bg" },
  { name: "DW News",              youtubeChannelId: "UCknLrEdhRCp1aegoMqRaCZg" },
  { name: "France 24 English",    youtubeChannelId: "UCQfwfsi5VrQ8yKZ-UWmAEFg" },
  { name: "ABC News Australia",   youtubeChannelId: "UCVgO39Bk5sMo66-6o6Spn6Q" },
  { name: "NBC News NOW",         youtubeChannelId: "UCeY0bbntWzzVIaj2z3QigXg" },
];

// How many seconds before the top of each hour to switch, so the new channel
// is already playing when its on-the-hour headlines start.
const SECONDS_BEFORE_HOUR_TO_SWITCH = 60;
