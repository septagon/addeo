const YOUTUBE_MAIN_VIDEO_ELEMENT_CLASS_NAME = "video-stream html5-main-video";

const params = new URLSearchParams(window.location.search);
const ADDEO = params.get("addeo");
const SCALE = params.has("scale") ? params.get("scale") : "30";
const POSITION = params.has("position") ? params.get("position") : "topleft";
const CHROMA_KEY = params.has("chromaKey") ? params.get("chromaKey") : null;
const THRESHOLD = params.has("threshold") ? parseFloat(params.get("threshold")) : 0.1;
const POWER = params.has("power") ? parseFloat(params.get("power")) : 2.0;

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
    const updateAdditiveContentStyle = function () {
        additiveContent.style.width = video.style.width;
        additiveContent.style.height = video.style.height;
        additiveContent.style.left = video.style.left;
        additiveContent.style.top = video.style.top;
    };
    updateAdditiveContentStyle();
    const videoResizeObserver = new MutationObserver(updateAdditiveContentStyle);
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
    iframe.style.backgroundColor = "transparent";
    iframe.style.pointerEvents = "none";
    iframe.allowTransparency = true;
    additiveContent.appendChild(iframe);

    // Helpers to allow play/pause behavior (which is a little fiddly due to asynchrony) to be 
    // pulled out for easy revision/enhancement later.
    const play = async function (video) {
        if (!video.paused) {
            return;
        }

        try {
            // TODO: Empirically, a display style of "none" changes the behavior of play() somehow,
            // causing strange behaviors. Until this is resolved, just put the display style to
            // block while awaiting play(), then reset it to what it's supposed to be. This causes
            // a one-frame flicker on resume, but at present it's not the top priority right now.
            const oldDisplay = video.style.display;
            video.style.display = "block";

            await video.play();

            video.style.display = oldDisplay;

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
            if (videoAdsObserver.adState !== videoAdsObserver.AD_STATE_PLAYING) {
                play(addeo);
            }
        };

        addeo.addEventListener("play", function () {
            if (video.paused || videoAdsObserver.adState === videoAdsObserver.AD_STATE_PLAYING) {
                pause(addeo);
            }
        });

        syncCurrentTime();

        if (CHROMA_KEY) {
            // From the excellent answer here: https://stackoverflow.com/questions/5623838/rgb-to-hex-and-hex-to-rgb
            const hexToRgb = function (hex) {
                var result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                return result ? {
                    r: (parseInt(result[1], 16) / 255.0),
                    g: (parseInt(result[2], 16) / 255.0),
                    b: (parseInt(result[3], 16) / 255.0)
                } : null;
            }
            const chromaKey = hexToRgb(CHROMA_KEY);
            if (!chromaKey) {
                return;
            }

            addeo.style.display = "none";
            // The YouTube embed iframe has some pretty aggressive background coloring, so we set
            // the whole ancestry's background to be transparent to be safe.
            const setBackgroundColorsTransparent = function (element) {
                element.style.backgroundColor = "transparent";
                if (element !== iframe.contentDocument.body) {
                    setBackgroundColorsTransparent(element.parentElement);
                }
            };
            setBackgroundColorsTransparent(addeo.parentElement);

            const canvas = iframe.contentDocument.createElement("canvas");
            canvas.style.position = "absolute";
            const updateCanvasStyle = function () {
                canvas.width = parseInt(addeo.style.width);
                canvas.height = parseInt(addeo.style.height);
                canvas.style.width = addeo.style.width;
                canvas.style.height = addeo.style.height;
                canvas.style.left = addeo.style.left;
                canvas.style.top = addeo.style.top;
            };
            updateCanvasStyle();
            const addeoResizeObserver = new MutationObserver(updateCanvasStyle);
            addeoResizeObserver.observe(addeo, { attributes : true, attributeFilter : ['style'] });
            
            addeo.parentElement.appendChild(canvas);

            // The following WebGL code is based heavily on the Mozilla WebGL tutorials culminating on
            // https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Tutorial/Animating_textures_in_WebGL
            const initTexture = function (gl) {
                const texture = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, texture);

                // Initialize with a transparent dummy pixel so we don't have to wait.
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
              
                return texture;
            };

            const updateTexture = function (gl, texture, video) {
                gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
            };

            const loadShader = function (gl, type, source) {
                const shader = gl.createShader(type);
                gl.shaderSource(shader, source);
                gl.compileShader(shader);
    
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                    console.dir(gl.getShaderInfoLog(shader));
                    throw new Error("Failed to compile shader!");
                }
    
                return shader;
            };

            // Takes a dependency on versions of Chrome from at least a decade ago, I guess.
            const gl = canvas.getContext("webgl2");
            gl.clearColor(0.0, 0.0, 0.0, 0.0);

            const vertexShaderSource = `
            precision highp float;

            attribute vec2 position;

            varying vec2 vUV;

            void main() {
                gl_Position = vec4(position.x * 2.0 - 1.0, position.y * 2.0 - 1.0, 1.0, 1.0);
                vUV = vec2(position.x, 1.0 - position.y);
            }
            `;

            const fragmentShaderSource = `
            precision highp float;

            varying vec2 vUV;

            uniform sampler2D textureSampler;
            uniform vec3 chromaKey;
            uniform float threshold;
            uniform float power;

            void main() {
                gl_FragColor = texture2D(textureSampler, vUV);

                vec3 offset = gl_FragColor.rgb - chromaKey;
                float distSquared = dot(offset, offset);
                float t = min(1.0, pow(distSquared, 0.5 * power) / pow(threshold, power));
                gl_FragColor = t * gl_FragColor + (1.0 - t) * vec4(0.0, 0.0, 0.0, 0.0);
            }
            `;

            const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
            const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

            const program = gl.createProgram();
            gl.attachShader(program, vertexShader);
            gl.attachShader(program, fragmentShader);

            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                console.dir(gl.getProgramInfoLog(program));
                throw new Error("Failed to link shader program!");
            }

            const vertexBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
            const positionLocation = gl.getAttribLocation(program, "position");
            const textureSamplerLocation = gl.getUniformLocation(program, "textureSampler");
            const chromaKeyLocation = gl.getUniformLocation(program, "chromaKey");
            const thresholdLocation = gl.getUniformLocation(program, "threshold");
            const powerLocation = gl.getUniformLocation(program, "power");

            const texture = initTexture(gl);

            const render = function () {
                gl.clear(gl.COLOR_BUFFER_BIT);

                updateTexture(gl, texture, addeo);

                gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
                gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
                gl.enableVertexAttribArray(positionLocation);

                gl.useProgram(program);

                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.uniform1i(textureSamplerLocation, 0);

                gl.uniform3f(chromaKeyLocation, chromaKey.r, chromaKey.g, chromaKey.b);
                gl.uniform1f(thresholdLocation, THRESHOLD);
                gl.uniform1f(powerLocation, POWER);

                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

                iframe.contentWindow.requestAnimationFrame(render);
            };
            iframe.contentWindow.requestAnimationFrame(render);
        }
    };

    iframe.onload = initializeAddeo;
};

injectAddeo();
