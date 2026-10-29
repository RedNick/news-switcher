// Hourly News Switcher
//
// Plays a live news stream full screen and moves to the next channel in
// NEWS_CHANNELS (see channels.js) shortly before every clock hour.
//
// The schedule is worked out from the clock, not from when the page was
// opened, so every open copy of the page shows the same channel at the same
// time. The Prev/Next buttons shift the whole rotation by one channel.

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const SWITCH_LEAD_MILLISECONDS = SECONDS_BEFORE_HOUR_TO_SWITCH * 1000;

// If a stream hasn't started playing this long after loading, treat the
// channel as not live right now and move on to the next one.
const STREAM_START_TIMEOUT_MILLISECONDS = 30 * 1000;

const EXTRAS_VISIBLE_STORAGE_KEY = "newsSwitcher.extrasVisible";

// --- State -----------------------------------------------------------------

let youtubePlayer = null;          // The current YT.Player instance.
let currentHourSlot = null;        // Which hourly slot is currently showing.
let manualChannelOffset = 0;       // Added by Prev/Next and by skipping dead streams.
let viewerWantsSound = false;      // Becomes true once the viewer unmutes.
let streamStartTimer = null;       // Watchdog for streams that never start.
let consecutiveFailedChannels = 0; // Stops us skipping forever if nothing is live.

// --- Page elements ---------------------------------------------------------

const playerContainer = document.getElementById("player-container");
const channelNameLabel = document.getElementById("channel-name");
const channelStatusLabel = document.getElementById("channel-status");
const nextChannelNameLabel = document.getElementById("next-channel-name");
const countdownLabel = document.getElementById("countdown");
const unmuteButton = document.getElementById("unmute-button");
const previousButton = document.getElementById("previous-button");
const nextButton = document.getElementById("next-button");
const toggleExtrasButton = document.getElementById("toggle-extras-button");

// --- Schedule maths --------------------------------------------------------

// Hourly slots begin SECONDS_BEFORE_HOUR_TO_SWITCH before each clock hour.
// Slot numbers count up from the Unix epoch, so they're the same everywhere.
function getHourSlotAt(timeInMilliseconds) {
  return Math.floor((timeInMilliseconds + SWITCH_LEAD_MILLISECONDS) / MILLISECONDS_PER_HOUR);
}

function getSlotStartTime(hourSlot) {
  return hourSlot * MILLISECONDS_PER_HOUR - SWITCH_LEAD_MILLISECONDS;
}

// Wraps any whole number (including negatives) into a valid channel index.
function wrapChannelIndex(index) {
  const channelCount = NEWS_CHANNELS.length;
  return ((index % channelCount) + channelCount) % channelCount;
}

function getChannelIndexForSlot(hourSlot) {
  return wrapChannelIndex(hourSlot + manualChannelOffset);
}

// --- Player ----------------------------------------------------------------

function buildLiveStreamEmbedUrl(youtubeChannelId) {
  const embedParameters = new URLSearchParams({
    channel: youtubeChannelId,
    autoplay: "1",
    mute: "1",          // Browsers only allow autoplay while muted.
    enablejsapi: "1",   // Lets this script control the player.
    playsinline: "1",
    rel: "0",
  });
  // The API needs to know our origin. A page opened from disk has none.
  if (window.location.origin.startsWith("http")) {
    embedParameters.set("origin", window.location.origin);
  }
  return "https://www.youtube.com/embed/live_stream?" + embedParameters.toString();
}

function loadChannel(channelIndex) {
  const channel = NEWS_CHANNELS[channelIndex];

  clearTimeout(streamStartTimer);
  if (youtubePlayer) {
    youtubePlayer.destroy(); // Also removes the old iframe.
    youtubePlayer = null;
  }

  // The live_stream embed isn't available through the API's own constructor
  // options, so we build the iframe ourselves and hand it to YT.Player.
  const playerIframe = document.createElement("iframe");
  playerIframe.src = buildLiveStreamEmbedUrl(channel.youtubeChannelId);
  playerIframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
  playerIframe.allowFullscreen = true;
  playerIframe.title = channel.name + " live stream";
  playerContainer.appendChild(playerIframe);

  youtubePlayer = new YT.Player(playerIframe, {
    events: {
      onReady: handlePlayerReady,
      onStateChange: handlePlayerStateChange,
      onError: handlePlayerError,
    },
  });

  channelNameLabel.textContent = channel.name;
  channelStatusLabel.textContent = "";
  document.title = channel.name + " · Hourly News Switcher";

  // Some channels show "not live" without raising an error, so also give up
  // if nothing starts playing in time.
  streamStartTimer = setTimeout(
    () => skipUnavailableChannel("didn't start"),
    STREAM_START_TIMEOUT_MILLISECONDS
  );

  updateNextUpLabels();
}

function handlePlayerReady() {
  if (viewerWantsSound) {
    youtubePlayer.unMute();
  }
  youtubePlayer.playVideo();
}

function handlePlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING) {
    clearTimeout(streamStartTimer);
    consecutiveFailedChannels = 0;
    channelStatusLabel.textContent = "● LIVE";
  }
}

function handlePlayerError() {
  skipUnavailableChannel("not available");
}

// Moves on to the next channel when the current one isn't streaming. The
// skip is kept for the rest of the hour by bumping the manual offset.
function skipUnavailableChannel(reason) {
  clearTimeout(streamStartTimer);
  consecutiveFailedChannels += 1;

  if (consecutiveFailedChannels >= NEWS_CHANNELS.length) {
    channelStatusLabel.textContent = "No channels are streaming right now";
    return;
  }

  const skippedChannelName = channelNameLabel.textContent;
  console.warn(`Skipping ${skippedChannelName}: ${reason}`);
  manualChannelOffset += 1;
  loadChannel(getChannelIndexForSlot(currentHourSlot));
  channelStatusLabel.textContent = `(${skippedChannelName} ${reason}, skipped)`;
}

// Changes channel by hand. Shifts the rotation, so the hourly order continues
// from the newly chosen channel.
function stepChannel(direction) {
  if (currentHourSlot === null) {
    return; // The YouTube API hasn't loaded yet.
  }
  consecutiveFailedChannels = 0;
  manualChannelOffset += direction;
  loadChannel(getChannelIndexForSlot(currentHourSlot));
}

// --- Sound -----------------------------------------------------------------

function turnSoundOn() {
  viewerWantsSound = true;
  if (youtubePlayer && youtubePlayer.unMute) {
    youtubePlayer.unMute();
    youtubePlayer.playVideo();
  }
  unmuteButton.hidden = true;
}

// Keeps the unmute button in step with the player, including when the viewer
// uses YouTube's own volume control instead of our button.
function syncSoundState() {
  if (!youtubePlayer || !youtubePlayer.isMuted) {
    return;
  }
  const playerIsMuted = youtubePlayer.isMuted();
  if (!playerIsMuted) {
    viewerWantsSound = true;
  }
  unmuteButton.hidden = !playerIsMuted;
}

// --- Extras panel ----------------------------------------------------------

function setExtrasVisible(extrasVisible) {
  document.body.classList.toggle("extras-hidden", !extrasVisible);
  try {
    localStorage.setItem(EXTRAS_VISIBLE_STORAGE_KEY, String(extrasVisible));
  } catch (storageError) {
    // Storage can be blocked (private browsing etc.). The toggle still works.
  }
}

function loadSavedExtrasVisibility() {
  try {
    return localStorage.getItem(EXTRAS_VISIBLE_STORAGE_KEY) !== "false";
  } catch (storageError) {
    return true;
  }
}

function toggleExtras() {
  setExtrasVisible(document.body.classList.contains("extras-hidden"));
}

function formatCountdown(remainingMilliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMilliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function updateNextUpLabels() {
  const nextChannelIndex = getChannelIndexForSlot(currentHourSlot + 1);
  nextChannelNameLabel.textContent = NEWS_CHANNELS[nextChannelIndex].name;
  const nextSwitchTime = getSlotStartTime(currentHourSlot + 1);
  countdownLabel.textContent = formatCountdown(nextSwitchTime - Date.now());
}

// --- Main loop -------------------------------------------------------------

// Runs every second: switches channel when a new hourly slot begins and
// refreshes the countdown.
function tick() {
  const hourSlotNow = getHourSlotAt(Date.now());
  if (hourSlotNow !== currentHourSlot) {
    currentHourSlot = hourSlotNow;
    consecutiveFailedChannels = 0;
    loadChannel(getChannelIndexForSlot(currentHourSlot));
  }
  updateNextUpLabels();
  syncSoundState();
}

// Called by the YouTube IFrame API script once it has loaded.
function onYouTubeIframeAPIReady() {
  tick();
  setInterval(tick, 1000);
}

// --- Wiring ----------------------------------------------------------------

setExtrasVisible(loadSavedExtrasVisibility());
unmuteButton.hidden = false;

unmuteButton.addEventListener("click", turnSoundOn);
previousButton.addEventListener("click", () => stepChannel(-1));
nextButton.addEventListener("click", () => stepChannel(+1));
toggleExtrasButton.addEventListener("click", toggleExtras);

document.addEventListener("keydown", (keyEvent) => {
  if (keyEvent.key === "h" || keyEvent.key === "H") toggleExtras();
  if (keyEvent.key === "ArrowLeft") stepChannel(-1);
  if (keyEvent.key === "ArrowRight") stepChannel(+1);
});
