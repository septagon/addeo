class SyncPeriod {
    videoTimeStart;
    videoTimeEnd;
    addeoTimeStart;
    addeoTimeEnd;
    videoPaused;
    addeoPaused;
    addeoHidden;
}

class PeriodInput {
    static _getTimestamp(clockString) {
        const tag = clockString.slice(0, 1);
        clockString = clockString.slice(1);

        const elements = clockString.split(":").reverse();
        let seconds = parseInt(elements[0]);
        if (elements.length > 1) {
            seconds += (60 * parseInt(elements[1]));
        }
        if (elements.length > 2) {
            seconds += (60 * 60 * parseInt(elements[2]));
        }
        // At present, we don't support clock times that begin with days.
        return {
            tag: tag, seconds: seconds
        };
    }

    static parse(periodString) {
        const periodElements = periodString.split(",");
        
        const period = new PeriodInput();
        period.timestamp = PeriodInput._getTimestamp(periodElements[0]);
        period.commands = [];

        let commandElements;
        for (let idx = 1; idx < periodElements.length; ++idx) {
            commandElements = periodElements[idx].split(/[()]/g);
            period.commands.push({
                command: commandElements[0],
                timestamp: PeriodInput._getTimestamp(commandElements[1])
            });
        }

        return period;
    }

    timestamp;
    commands;

    getTimestamp(tag) {
        if (this.timestamp.tag === tag) {
            return this.timestamp;
        }

        for (let idx = 0; idx < this.commands.length; ++idx) {
            if (this.commands[idx].timestamp.tag === tag && this.commands[idx].command !== "seek") {
                return this.commands[idx].timestamp;
            }
        }

        return undefined;
    }

    getCommandTimestamp(tag, command) {
        for (let idx = 0; idx < this.commands.length; ++idx) {
            if (this.commands[idx].timestamp.tag === tag && this.commands[idx].command === command) {
                return this.commands[idx].timestamp;
            }
        };
        return undefined;
    }
}

class SynchronizationTimeSeries {
    _periods;
    _currentPeriodIdx;
    
    currentTimeVideo;
    currentTimeAddeo;
    nextPeriodTimeVideo;
    nextPeriodTimeAddeo;
    videoPaused;
    addeoPaused;
    addeoHidden;

    constructor (paramString) {
        this._periods = [];
        this._currentPeriodIdx = 0;
        
        const periodInputs = paramString.split(";").map(PeriodInput.parse);

        let videoTime = 0;
        let addeoTime = 0;

        let period = new SyncPeriod(), priorPeriod;
        this._periods.push(period);
        period.videoTimeStart = 0;
        period.addeoTimeStart = 0;
        period.videoPaused = false;
        period.addeoPaused = true;
        period.addeoHidden = true;

        for (let periodIdx = 0; periodIdx < periodInputs.length; ++periodIdx) {
            const periodInput = periodInputs[periodIdx];

            if (periodInput.commands.length === 0) {
                continue;
            }

            // Finish the existing period.
            {
                const videoTimestamp = periodInput.getTimestamp("v");
                const addeoTimestamp = periodInput.getTimestamp("a");

                if (videoTimestamp === undefined && addeoTimestamp === undefined) {
                    console.warn("Illegal period input:\n" + periodInput + "\nSkipping.");
                    continue;
                }

                if (videoTimestamp !== undefined) {
                    period.videoTimeEnd = videoTimestamp.seconds;
                } else {
                    period.videoTimeEnd = videoTime + (addeoTimestamp.seconds - addeoTime);
                }

                if (addeoTimestamp !== undefined) {
                    period.addeoTimeEnd = addeoTimestamp.seconds;
                } else {
                    period.addeoTimeEnd = addeoTime + (videoTimestamp.seconds - videoTime);
                }

                videoTime = period.videoTimeEnd;
                addeoTime = period.addeoTimeEnd;
            }

            priorPeriod = period;
            period = new SyncPeriod();
            this._periods.push(period);

            // Begin the new period.
            {
                period.videoTimeStart = videoTime;
                period.addeoTimeStart = addeoTime;
                period.videoPaused = priorPeriod.videoPaused;
                period.addeoPaused = priorPeriod.addeoPaused;
                period.addeoHidden = priorPeriod.addeoHidden;

                const videoSeekTimestamp = periodInput.getCommandTimestamp("v", "seek");
                if (videoSeekTimestamp) {
                    period.videoTimeStart = videoSeekTimestamp.seconds;
                    // Seek implies play
                    period.videoPaused = false;
                }
                const addeoSeekTimestamp = periodInput.getCommandTimestamp("a", "seek");
                if (addeoSeekTimestamp) {
                    period.addeoTimeStart = addeoSeekTimestamp.seconds;
                    // Seek implies play and unhide
                    period.addeoPaused = false;
                    period.addeoHidden = false;
                }

                if (priorPeriod.videoPaused && periodInput.getCommandTimestamp("v", "play")) {
                    period.videoPaused = false;
                } else if (!priorPeriod.videoPaused && periodInput.getCommandTimestamp("v", "pause")) {
                    period.videoPaused = true;
                }

                if (priorPeriod.addeoPaused && periodInput.getCommandTimestamp("a", "play")) {
                    period.addeoPaused = false;
                    // Play implies unhide
                    period.addeoHidden = false;
                } else if (!priorPeriod.addeoPaused && periodInput.getCommandTimestamp("a", "pause")) {
                    period.addeoPaused = true;
                }

                if (!priorPeriod.addeoHidden && periodInput.getCommandTimestamp("a", "hide")) {
                    period.addeoHidden = true;
                    // Hide implies pause
                    period.addeoPaused = true;
                }
            }
        }
        
        this.currentTimeVideo = this._periods[0].videoTimeStart;
        this.currentTimeAddeo = this._periods[0].addeoTimeStart;
        this.nextPeriodTimeVideo = this._periods.length > 1 ? this._periods[1].videoTimeStart : undefined;
        this.nextPeriodTimeAddeo = this._periods.length > 1 ? this._periods[1].addeoTimeStart : undefined;
        this.videoPaused = this._periods[0].videoPaused;
        this.addeoPaused = this._periods[0].addeoPaused;
        this.addeoHidden = this._periods[0].addeoHidden;
    }

    seek(newCurrentTimeVideo) {
        // Note: This implementation takes a hard dependency on the fact that the period will always have
        // an undefind videoTimeEnd. If that contract ever changes, this method will cease to function correctly.
        let periodIdx;
        for (periodIdx = 0; periodIdx < this._periods.length; ++periodIdx) {
            if (!this._periods[periodIdx].videoPaused && 
                this._periods[periodIdx].videoTimeStart <= newCurrentTimeVideo &&
                (this._periods[periodIdx].videoTimeEnd > newCurrentTimeVideo || this._periods[periodIdx].videoTimeEnd === undefined)) {
                break;
            }
        }
        if (periodIdx === this._periods.length) {
            for (periodIdx = 0; periodIdx < this._periods.length - 1; periodIdx++) {
                if (!this._periods[periodIdx].videoPaused && this._periods[periodIdx].videoTimeStart > newCurrentTimeVideo) {
                    break;
                }
            }
        }
        
        const period = this._periods[periodIdx];
        newCurrentTimeVideo = Math.max(newCurrentTimeVideo, period.videoTimeStart);
        if (period.videoTimeEnd !== undefined) {
            newCurrentTimeVideo = Math.min(newCurrentTimeVideo, period.videoTimeEnd);
        }

        // Calculate the current addeo time.
        let newCurrentTimeAddeo;
        if (period.addeoTimeEnd !== undefined) {
            const t = (newCurrentTimeVideo - period.videoTimeStart) / (period.videoTimeEnd - period.videoTimeStart);
            newCurrentTimeAddeo = period.addeoTimeStart + t * (period.addeoTimeEnd - period.addeoTimeStart);
        } else {
            newCurrentTimeAddeo = period.addeoTimeStart + (newCurrentTimeVideo - period.videoTimeStart);
        }

        this._currentPeriodIdx = periodIdx;
        this.currentTimeVideo = newCurrentTimeVideo;
        this.currentTimeAddeo = newCurrentTimeAddeo;
        this.nextPeriodTimeVideo = this._periods.length > this._currentPeriodIdx + 1 ? this._periods[this._currentPeriodIdx + 1].videoTimeStart : undefined;
        this.nextPeriodTimeAddeo = this._periods.length > this._currentPeriodIdx + 1 ? this._periods[this._currentPeriodIdx + 1].addeoTimeStart : undefined;
        this.videoPaused = period.videoPaused;
        this.addeoPaused = period.addeoPaused;
        this.addeoHidden = period.addeoHidden;
    }

    update(currentTimeVideo, currentTimeAddeo) {
        // Advance what period we're in, if necessary
        let period = this._periods[this._currentPeriodIdx];
        let advancePeriod = true;
        if (period.videoPaused) {
            advancePeriod = currentTimeAddeo >= period.addeoTimeEnd;
        } else {
            advancePeriod = currentTimeVideo >= period.videoTimeEnd;
        }

        // Update cached values
        if (advancePeriod) {
            this._currentPeriodIdx += 1;
            period = this._periods[this._currentPeriodIdx];

            this.currentTimeVideo = period.videoTimeStart;
            this.currentTimeAddeo = period.addeoTimeStart;
            this.nextPeriodTimeVideo = this._periods.length > this._currentPeriodIdx + 1 ? this._periods[this._currentPeriodIdx + 1].videoTimeStart : undefined;
            this.nextPeriodTimeAddeo = this._periods.length > this._currentPeriodIdx + 1 ? this._periods[this._currentPeriodIdx + 1].addeoTimeStart : undefined;
            this.videoPaused = period.videoPaused;
            this.addeoPaused = period.addeoPaused;
            this.addeoHidden = period.addeoHidden;
        } else {
            if (period.videoPaused) {
                this.currentTimeVideo = period.videoTimeStart;
                this.currentTimeAddeo = currentTimeAddeo;
            } else {
                this.currentTimeVideo = currentTimeVideo;
                const t = (this.currentTimeVideo - period.videoTimeStart) / (period.videoTimeEnd - period.videoTimeStart);
                this.currentTimeAddeo = period.addeoTimeStart + t * (period.addeoTimeEnd - period.addeoTimeStart);
            }
        }
    }
}

class MessageSender {
    _asyncCallbacks;
    _nextAsyncId;
    _listeners;

    constructor () {
        this._asyncCallbacks = new Map();
        this._nextAsyncId = 0;
        this._listeners = new Map();

        chrome.runtime.onMessage.addListener(this._messageListener.bind(this));
    }

    addListener(kind, listener) {
        if (!this._listeners.has(kind)) {
            this._listeners.set(kind, []);
        }
        this._listeners.get(kind).push(listener);
    }

    async sendAsync(message) {
        message.sender = "video";
        message.async_id = this._nextAsyncId++;
        const promise = new Promise((resolve) => {
            this._asyncCallbacks.set(message.async_id, resolve);
        });
        chrome.runtime.sendMessage(message);
        return promise;
    }

    _currentKindListeners;
    _messageListener(message, sender, sendResponse) {
        if (message.sender === "video") {
            return;
        }
        if (message.async_id !== undefined) {
            this._asyncCallbacks.get(message.async_id)(message);
            this._asyncCallbacks.delete(message.async_id);
        } else if (this._listeners.has(message.kind)) {
            this._currentKindListeners = this._listeners.get(message.kind);
            for (let idx = 0; idx < this._currentKindListeners.length; ++idx) {
                this._currentKindListeners[idx](message);
            }
        }
    }
}

class SynchronizedVideoController {
    _video;
    _additiveContent;
    _sync;
    _sender;
    _currentTimeAddeoCache;
    _playbackRateAddeoCache;

    _addeoPlaying;
    _updating;
    _seeking;

    _expectedPlayCalls;
    _expectedPauseCalls;
    _expectedSeekCalls;

    constructor (video, additiveContent, synchronizationInstructions, chromakey) {
        this._video = video;
        this._additiveContent = additiveContent;
        this._sync = new SynchronizationTimeSeries(synchronizationInstructions);
        this._sender = new MessageSender();
        
        this._currentTimeAddeoCache = 0;
        this._playbackRateAddeoCache = 1;

        this._updating = false;
        this._seeking = false;
        
        this._expectedPlayCalls = 0;
        this._expectedPauseCalls = 0;
        this._expectedSeekCalls = 0;
        
        this._sender.addListener("loaded", () => {
            this._video.addEventListener("play", this._onVideoPlayed.bind(this));
            this._video.addEventListener("pause", this._onVideoPaused.bind(this));
            this._video.addEventListener("seeking", this._onVideoSeeking.bind(this));
            this._video.addEventListener("timeupdate", this._onVideoTimeUpdated.bind(this));
            
            this._sender.addListener("timeupdated", this._addeoTimeUpdated.bind(this));
            
            if (chromakey !== undefined) {
                const chromakeyArgs = chromakey.split(",");
                this._sender.sendAsync({
                    kind: "chromakey",
                    colorCode: chromakeyArgs[0],
                    threshold: parseFloat(chromakeyArgs[1]),
                    power: parseFloat(chromakeyArgs[2])
                });
            }
            
            this._expectedPlayCalls += 1;
            this._video.play();
            this._sync.seek(this._video.currentTime);
            this._onVideoSeeking();
        });
        
        this._sync.seek(this._video.currentTime);
        this._video.pause();
    }

    _addeoTimeUpdated(message) {
        this._currentTimeAddeoCache = message.currentTime;
        
        if (this._sync.videoPaused) {
            // If the video is paused, then the addeo's timeupdated is responsible for calling update.
            this._update();
        }
    }

    _onVideoPlayed() {
        if (this._expectedPlayCalls > 0) {
            this._expectedPlayCalls -= 1;
            return;
        }
        
        if (this._sync.videoPaused) {
            this._expectedPauseCalls += 1;
            this._video.pause();
        }
        
        if (!this._sync.addeoPaused) {
            this._playAddeo();
        }

        // HACK: To work around UI issues, if we get a play event while the 
        // addeo is already playing and the video is supposed to be paused,
        // we interpret this as a request to pause the addeo.
        if (this._addeoPlaying && this._sync.videoPaused) {
            this._pauseAddeo();
        }
    }

    _onVideoPaused() {
        if (this._expectedPauseCalls > 0) {
            this._expectedPauseCalls -= 1;
            return;
        }
        
        this._pauseAddeo();
    }

    async _onVideoSeeking() {
        if (this._expectedSeekCalls > 0) {
            this._expectedSeekCalls -= 1;
            return;
        }
        this._seeking = true;

        this._sync.seek(this._video.currentTime);

        // Ensure the video is actually at the correct time.
        if (this._sync.currentTimeVideo !== this._video.currentTime) {
            this._expectedSeekCalls += 1;
            console.log("Setting current time to " + this._sync.currentTimeVideo);
            this._video.currentTime = this._sync.currentTimeVideo;
        }

        // Pause, wait for the addeo to finish seeking, then resume as necessary.
        if (!this._video.paused) {
            this._expectedPauseCalls += 1;
            this._video.pause();
        }
        this._additiveContent.style.visibility = this._sync.addeoHidden ? "hidden" : "visible";
        if (this._sync.addeoPaused) {
            this._pauseAddeo()
        }
        await this._seekAddeo();
        if (!this._sync.addeoPaused) {
            await this._playAddeo();
        }
        if (!this._sync.videoPaused) {
            this._expectedPlayCalls += 1;
            await this._video.play();
        }

        this._seeking = false;
    }

    _onVideoTimeUpdated() {
        if (!this._sync.videoPaused) {
            // If the video is not paused, video's timeupdated is responsible for calling update.
            this._update();
        }
    }

    async _playAddeo() {
        await this._sender.sendAsync({
            kind: "play"
        });
        this._addeoPlaying = true;
    }

    async _pauseAddeo() {
        await this._sender.sendAsync({
            kind: "pause"
        });
        this._addeoPlaying = false;
    }

    async _seekAddeo() {
        await this._sender.sendAsync({
            kind: "seek",
            currentTime: this._sync.currentTimeAddeo
        });
    }

    async _playbackRateAddeo(playbackRate) {
        await this._sender.sendAsync({
            kind: "playbackrate",
            playbackRate: playbackRate
        });
    }

    async _update() {
        if (this._updating || this._seeking) {
            return;
        }
        this._updating = true;

        let wasVideoPaused = this._sync.videoPaused;
        let wasAddeoPaused = this._sync.addeoPaused;
        let wasAddeoHidden = this._sync.addeoHidden;

        this._sync.update(this._video.currentTime, this._currentTimeAddeoCache);

        if (!wasVideoPaused && this._sync.videoPaused) {
            this._expectedPauseCalls += 1;
            this._video.pause();
        } else if (wasVideoPaused && !this._sync.videoPaused) {
            this._expectedPlayCalls += 1;
            this._video.play();
        }

        if (!wasAddeoPaused && this._sync.addeoPaused) {
            this._pauseAddeo();
        } else if (wasAddeoPaused && !this._sync.addeoPaused) {
            this._playAddeo();
        }

        if (!wasAddeoHidden && this._sync.addeoHidden) {
            this._additiveContent.style.visibility = "hidden";
        } else if (wasAddeoHidden && !this._sync.addeoHidden) {
            this._additiveContent.style.visibility = "visible";
        }

        const SEEK_THRESHOLD = 1;
        if (Math.abs(this._video.currentTime - this._sync.currentTimeVideo) > SEEK_THRESHOLD) {
            this._expectedSeekCalls += 1;
            this._video.currentTime = this._sync.currentTimeVideo;
        } else {
            const addeoSynchronizationError = this._sync.currentTimeAddeo - this._currentTimeAddeoCache;
            if (!this._sync.videoPaused && Math.abs(addeoSynchronizationError) > SEEK_THRESHOLD) {
                await this._seekAddeo();
            } else {
                // TODO: Something less naive than this.
                if (addeoSynchronizationError > SEEK_THRESHOLD / 2) {
                    await this._playbackRateAddeo(1.01);
                } else if (addeoSynchronizationError < -SEEK_THRESHOLD / 2) {
                    await this._playbackRateAddeo(0.99);
                } else {
                    await this._playbackRateAddeo(1);
                }
            }
        }

        this._updating = false;
    }
}
