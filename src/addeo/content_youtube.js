const YOUTUBE_MAIN_VIDEO_ELEMENT_CLASS_NAME = "video-stream html5-main-video";

const params = new URLSearchParams(window.location.search);
const ADDEO = params.get("addeo");
const SCALE = params.has("scale") ? params.get("scale") : "30";
const POSITION = params.has("position") ? params.get("position") : "topleft";

// TODO: Replace all internals of this class with a real eventing system for ad observation.
class AdStateObserver {
    _root;
    _eventListeners;
    _oldAdState;
    _AD_STATE_LOOP_FRAMES_PER_SECOND = 30;
    _disposed = false;
    
    AD_STATE_STOPPED = 0;
    AD_STATE_PLAYING = 1;
    
    adState;

    constructor(root) {
        this._root = root;
        this._eventListeners = {
            "adstart": [],
            "adstop": []
        };
        this._oldAdState = this.AD_STATE_STOPPED;
        this._disposed = false;

        this.adState = this.AD_STATE_STOPPED;

        const adPlayingCheckLoop = () => {
            if (this._disposed) {
                return;
            }

            this._oldAdState = this.adState;
            this.adState = this._isAdPlaying() ? this.AD_STATE_PLAYING : this.AD_STATE_STOPPED;
            if (this._oldAdState === this.AD_STATE_STOPPED && this.adState === this.AD_STATE_PLAYING) {
                this._eventListeners["adstart"].forEach((callback) => {
                    callback(this);
                });
            } else if (this._oldAdState === this.AD_STATE_PLAYING && this.adState === this.AD_STATE_STOPPED) {
                this._eventListeners["adstop"].forEach((callback) => {
                    callback(this);
                });
            }
            setTimeout(adPlayingCheckLoop, 1000 / this.AD_PLAYING_LOOP_FRAMES_PER_SECOND);
        };
        setTimeout(adPlayingCheckLoop, 0);
    }

    addEventListener = function(event, callback) {
        if (event !== "adstart" && event !== "adstop") {
            console.warn("Ignoring unsupported event " + event + ". Supported events are \"adstart\" and \"adstop\".");
            return;
        }
        
        this._eventListeners[event].push(callback);
    }

    dispose = function () {
        this._disposed = true;
    }

    // This takes a dependency on an empirically-observed implementation detail of the YouTube desktop experience.
    // It basically looks for the kind of text that shows up when YouTube displays an ad, and if there's any, it
    // deduces that an ad is playing. Needless to say, this is ludicrously fragile and should be replaced with 
    // something better as soon as such an alternative presents itself.
    _isAdPlaying = function () {
        return this._root.getElementsByClassName("ytp-ad-text").length > 0;
    }
}

const injectAddeo = function () {
    const mainVideosQuery = document.getElementsByClassName(YOUTUBE_MAIN_VIDEO_ELEMENT_CLASS_NAME);
    const video = mainVideosQuery[0];

    const videoAdsObserver = new AdStateObserver(document);

    const additiveContent = document.createElement("div");
    additiveContent.style.position = "relative";
    additiveContent.style.display = "block";
    const updateStyle = function () {
        additiveContent.style.width = video.style.width;
        additiveContent.style.height = video.style.height;
        additiveContent.style.left = video.style.left;
        additiveContent.style.top = video.style.top;
    };
    updateStyle();
    const videoResizeObserver = new MutationObserver(updateStyle);
    videoResizeObserver.observe(video, { attributes : true, attributeFilter : ['style'] });
    video.parentElement.appendChild(additiveContent);

    videoAdsObserver.addEventListener("adstart", () => {
        additiveContent.style.display = "none";
    });
    videoAdsObserver.addEventListener("adstop", () => {
        additiveContent.style.display = "block";
    });

    const iframe = document.createElement("iframe");
    iframe.src = "https://www.youtube.com/embed/" + ADDEO + "?autoplay=1&controls=0";
    iframe.allow = "autoplay; encrypted-media;";
    iframe.allowFullscreen = true;
    iframe.style.position = "absolute";
    iframe.style.width = SCALE + "%";
    iframe.style.height = SCALE + "%";
    switch (POSITION) {
        case "topleft":
            iframe.style.top = "0px";
            iframe.style.left = "0px";
            break;
        case "topright":
            iframe.style.top = "0px";
            iframe.style.right = "0px";
            break;
        case "bottomleft":
            iframe.style.bottom = "0px";
            iframe.style.left = "0px";
            break;
        case "bottomright":
            iframe.style.bottom = "0px";
            iframe.style.right = "0px";
            break;
    }
    iframe.style.pointerEvents = "none";
    additiveContent.appendChild(iframe);

    // Helpers to allow play/pause behavior (which is a little fiddly due to asynchrony) to be 
    // pulled out for easy revision/enhancement later.
    const play = async function (video) {
        if (!video.paused) {
            return;
        }

        try {
            await video.play();
        } catch (e) {
            console.error(e);
        }
    };
    const pause = function (video) {
        if (video.paused) {
            return;
        }
        
        video.pause();
    }

    // Crude but workable mechanism to prevent listener leaks when the iframe refreshes.
    let onVideoAdStarted = () => {};
    let onVideoAdStopped = () => {};
    let onVideoPaused = () => {};
    let onVideoPlayed = () => {};
    let onVideoSeeked = () => {};
    videoAdsObserver.addEventListener("adstart", function () {
        onVideoAdStarted();
    });
    videoAdsObserver.addEventListener("adstop", function () {
        onVideoAdStopped();
    });
    video.addEventListener("pause", function () {
        onVideoPaused();
    });
    video.addEventListener("play", function () {
        onVideoPlayed();
    });
    video.addEventListener("seeked", function () {
        onVideoSeeked();
    });

    const initializeAddeo = function () {
        const addeo = iframe.contentDocument.getElementsByClassName(YOUTUBE_MAIN_VIDEO_ELEMENT_CLASS_NAME)[0];

        // Hack to get around the fact that is seems like onload is the wrong event to use for this 
        // (timing is nondeterministic?!?), but I don't know what the right event is and onload is 
        // close enough to be usable for now with this minor workaround.
        if (!addeo) {
            console.warn("Failed to find addeo! Possible timing issue with onload; retrying.");
            setTimeout(initializeAddeo, 10);
            return;
        }

        let resumeOnSeeked = false;
        const syncCurrentTime = function () {
            addeo.currentTime = video.currentTime;

            if (!video.paused) {
                pause(video);
                resumeOnSeeked = true;
            }
        };
        onVideoSeeked = syncCurrentTime;
        addeo.addEventListener("seeked", function () {
            if (resumeOnSeeked) {
                play(video);
                resumeOnSeeked = false;
            }
        });

        onVideoAdStarted = function () {
            pause(addeo);
        };
        onVideoAdStopped = function () {
            syncCurrentTime();
        };

        onVideoPaused = function () {
            pause(addeo);
        };
        onVideoPlayed = function () {
            if (videoAdsObserver.adState === videoAdsObserver.AD_STATE_STOPPED) {
                play(addeo);
            }
        };

        addeo.addEventListener("play", function () {
            if (video.paused || videoAdsObserver.adState === videoAdsObserver.AD_STATE_PLAYING) {
                pause(addeo);
            }
        });

        syncCurrentTime();
    };

    iframe.onload = initializeAddeo;
};

injectAddeo();
