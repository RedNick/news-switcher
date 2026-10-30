// Hourly News Switcher
//
// Plays a live news stream full screen and moves to the next channel in
// NEWS_CHANNELS (see channels.js) shortly before every clock hour.
//
// The schedule is worked out from the clock, not from when the page was
// opened, so every open copy of the page shows the same channel at the same
// time. The Prev/Next buttons shift the whole rotation by one channel.
//
// The ☰ menu lets the viewer choose which channels are in the rotation and
// jump straight to one. Those choices are saved in this browser.

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const SWITCH_LEAD_MILLISECONDS = SECONDS_BEFORE_HOUR_TO_SWITCH * 1000;

// If a stream hasn't started playing this long after loading, treat the
// channel as not live right now and move on to the next one.
const STREAM_START_TIMEOUT_MILLISECONDS = 30 * 1000;

const EXTRAS_VISIBLE_STORAGE_KEY = "newsSwitcher.extrasVisible";
const DISABLED_CHANNELS_STORAGE_KEY = "newsSwitcher.disabledChannelIds";

// --- State -----------------------------------------------------------------

let youtubePlayer = null;          // The current YT.Player instance.
let currentChannel = null;         // The NEWS_CHANNELS entry now playing.
let currentHourSlot = null;        // Which hourly slot is currently showing.
let manualChannelOffset = 0;       // Added by Prev/Next, the menu and skipping dead streams.
let viewerWantsSound = false;      // Becomes true once the viewer unmutes.
let streamStartTimer = null;       // Watchdog for streams that never start.
let consecutiveFailedChannels = 0; // Stops us skipping forever if nothing is live.

// Channel IDs the viewer has unticked in the menu. Stored as "disabled"
// rather than "enabled" so channels added to channels.js later start ticked.
let disabledChannelIds = new Set(loadSavedList(DISABLED_CHANNELS_STORAGE_KEY));

// --- Page elements ---------------------------------------------------------

const playerContainer = document.getElementById("player-container");
const channelNameLabel = document.getElementById("channel-name");
const channelStatusLabel = document.getElementById("channel-status");
const nextChannelNameLabel = document.getElementById("next-channel-name");
const countdownLabel = document.getElementById("countdown");
const unmuteButton = document.getElementById("unmute-button");
const previousButton = document.getElementById("previous-button");
const nextButton = document.getElementById("next-button");
const menuButton = document.getElementById("menu-button");
const settingsMenu = document.getElementById("settings-menu");
const showExtrasCheckbox = document.getElementById("show-extras-checkbox");
const sourceList = document.getElementById("source-list");

// --- Saved settings --------------------------------------------------------

// Storage can be blocked (private browsing etc.), so every access is guarded
// and the page carries on with defaults.
function saveSetting(storageKey, value) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch (storageError) {
    // Not saved, but the setting still applies for this visit.
  }
}

function loadSetting(storageKey, defaultValue) {
  try {
    const savedValue = localStorage.getItem(storageKey);
    return savedValue === null ? defaultValue : JSON.parse(savedValue);
  } catch (storageError) {
    return defaultValue;
  }
}

function loadSavedList(storageKey) {
  const savedList = loadSetting(storageKey, []);
  return Array.isArray(savedList) ? savedList : [];
}

// --- Which channels are in the rotation ------------------------------------

function getActiveChannels() {
  const activeChannels = NEWS_CHANNELS.filter(
    (channel) => !disabledChannelIds.has(channel.youtubeChannelId)
  );
  // Never let the rotation be empty: fall back to every channel.
  return activeChannels.length > 0 ? activeChannels : NEWS_CHANNELS;
}

// --- Schedule maths --------------------------------------------------------

// Hourly slots begin SECONDS_BEFORE_HOUR_TO_SWITCH before each clock hour.
// Slot numbers count up from the Unix epoch, so they're the same everywhere.
function getHourSlotAt(timeInMilliseconds) {
  return Math.floor((timeInMilliseconds + SWITCH_LEAD_MILLISECONDS) / MILLISECONDS_PER_HOUR);
}

function getSlotStartTime(hourSlot) {
  return hourSlot * MILLISECONDS_PER_HOUR - SWITCH_LEAD_MILLISECONDS;
}

// Wraps any whole number (including negatives) into the range 0..count-1.
function wrapIndex(index, count) {
  return ((index % count) + count) % count;
}

function getChannelForSlot(hourSlot) {
  const activeChannels = getActiveChannels();
  return activeChannels[wrapIndex(hourSlot + manualChannelOffset, activeChannels.length)];
}

// Sets the offset so the current slot lands on the given channel. The rotation
// then carries on in order from there.
function pointRotationAt(channel) {
  const activeIndex = getActiveChannels().indexOf(channel);
  if (activeIndex !== -1) {
    manualChannelOffset = activeIndex - currentHourSlot;
  }
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

function loadChannel(channel) {
  currentChannel = channel;

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
  renderSourceList();
}

function loadChannelForCurrentSlot() {
  loadChannel(getChannelForSlot(currentHourSlot));
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

  if (consecutiveFailedChannels >= getActiveChannels().length) {
    channelStatusLabel.textContent = "No channels are streaming right now";
    return;
  }

  const skippedChannelName = currentChannel.name;
  console.warn(`Skipping ${skippedChannelName}: ${reason}`);
  manualChannelOffset += 1;
  loadChannelForCurrentSlot();
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
  loadChannelForCurrentSlot();
}

// Plays the chosen channel now (from the menu) and continues the rotation
// from it.
function watchChannelNow(channel) {
  if (currentHourSlot === null) {
    return;
  }
  // A channel picked to watch is put back in the rotation if it was out.
  if (disabledChannelIds.has(channel.youtubeChannelId)) {
    setChannelInRotation(channel, true);
  }
  consecutiveFailedChannels = 0;
  pointRotationAt(channel);
  loadChannel(channel);
}

// Ticks or unticks a channel in the menu.
function setChannelInRotation(channel, isInRotation) {
  if (isInRotation) {
    disabledChannelIds.delete(channel.youtubeChannelId);
  } else {
    disabledChannelIds.add(channel.youtubeChannelId);
  }
  saveSetting(DISABLED_CHANNELS_STORAGE_KEY, [...disabledChannelIds]);

  if (currentHourSlot === null) {
    renderSourceList();
    return;
  }

  // Keep the current channel playing if it's still in the rotation;
  // otherwise move on to whatever the rotation now gives for this hour.
  if (getActiveChannels().includes(currentChannel)) {
    pointRotationAt(currentChannel);
    updateNextUpLabels();
    renderSourceList();
  } else {
    loadChannelForCurrentSlot();
  }
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

// --- Menu and extras panel -------------------------------------------------

function setMenuOpen(menuIsOpen) {
  settingsMenu.hidden = !menuIsOpen;
  menuButton.setAttribute("aria-expanded", String(menuIsOpen));
}

function toggleMenu() {
  setMenuOpen(settingsMenu.hidden);
}

function setExtrasVisible(extrasVisible) {
  document.body.classList.toggle("extras-hidden", !extrasVisible);
  showExtrasCheckbox.checked = extrasVisible;
  saveSetting(EXTRAS_VISIBLE_STORAGE_KEY, extrasVisible);
}

// Rebuilds the list of channels in the menu: a tick box for whether each one
// is in the rotation, and a button to watch it now.
function renderSourceList() {
  const activeChannels = getActiveChannels();
  sourceList.replaceChildren();

  for (const channel of NEWS_CHANNELS) {
    const isInRotation = !disabledChannelIds.has(channel.youtubeChannelId);
    const isLastTickedChannel = isInRotation && activeChannels.length === 1;

    const sourceRow = document.createElement("li");
    sourceRow.classList.toggle("is-playing", channel === currentChannel);

    const rotationCheckbox = document.createElement("input");
    rotationCheckbox.type = "checkbox";
    rotationCheckbox.checked = isInRotation;
    rotationCheckbox.disabled = isLastTickedChannel; // Keep at least one.
    rotationCheckbox.title = isLastTickedChannel
      ? "At least one channel has to stay in the rotation"
      : "Include in the hourly rotation";
    rotationCheckbox.setAttribute("aria-label", "Include " + channel.name + " in the rotation");
    rotationCheckbox.addEventListener("change", () =>
      setChannelInRotation(channel, rotationCheckbox.checked)
    );

    const watchButton = document.createElement("button");
    watchButton.type = "button";
    watchButton.className = "watch-button";
    watchButton.textContent = channel.name;
    watchButton.title = "Watch " + channel.name + " now";
    watchButton.addEventListener("click", () => watchChannelNow(channel));

    sourceRow.append(rotationCheckbox, watchButton);
    sourceList.appendChild(sourceRow);
  }
}

function formatCountdown(remainingMilliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMilliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function updateNextUpLabels() {
  nextChannelNameLabel.textContent = getChannelForSlot(currentHourSlot + 1).name;
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
    loadChannelForCurrentSlot();
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

setExtrasVisible(loadSetting(EXTRAS_VISIBLE_STORAGE_KEY, true) !== false);
setMenuOpen(false);
renderSourceList();
unmuteButton.hidden = false;

unmuteButton.addEventListener("click", turnSoundOn);
previousButton.addEventListener("click", () => stepChannel(-1));
nextButton.addEventListener("click", () => stepChannel(+1));
menuButton.addEventListener("click", toggleMenu);
showExtrasCheckbox.addEventListener("change", () =>
  setExtrasVisible(showExtrasCheckbox.checked)
);

document.addEventListener("keydown", (keyEvent) => {
  // Don't steal keys while a menu control has focus (e.g. Space on a tick box).
  if (keyEvent.target instanceof HTMLInputElement) {
    return;
  }
  if (keyEvent.key === "h" || keyEvent.key === "H") setExtrasVisible(!showExtrasCheckbox.checked);
  if (keyEvent.key === "m" || keyEvent.key === "M") toggleMenu();
  if (keyEvent.key === "Escape") setMenuOpen(false);
  if (keyEvent.key === "ArrowLeft") stepChannel(-1);
  if (keyEvent.key === "ArrowRight") stepChannel(+1);
});
