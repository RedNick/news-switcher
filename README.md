# Hourly News Switcher

A web page that plays a 24/7 live news stream full screen and switches to the next channel one minute before every clock hour, so each channel's top-of-hour headlines are already playing.

**Live page:** https://rednick.github.io/news-switcher/

## Using it

- The page starts muted (browsers block autoplay with sound). Click **Tap to turn sound on** once; later channels keep the sound on.
- **☰** or the **H** key shows/hides the extras: current channel, next channel, countdown, and Prev/Next buttons.
- **←** / **→** change channel. The hourly rotation then carries on from the channel you picked.
- A channel that isn't streaming (or doesn't start within 30 seconds) is skipped for that hour.

## Changing the channels

Edit `channels.js`. Each channel is listed by its YouTube channel ID (starts with `UC`), not a video ID, so it keeps working when YouTube replaces a stream's video. `SECONDS_BEFORE_HOUR_TO_SWITCH` sets how early before the hour the switch happens.

## Files

- `index.html`: page layout
- `styles.css`: styling
- `channels.js`: channel list and switch timing
- `news-switcher.js`: schedule, player and controls
