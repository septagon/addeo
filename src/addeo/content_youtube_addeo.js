const YOUTUBE_MAIN_VIDEO_ELEMENT_CLASS_NAME = "video-stream html5-main-video";
const getYouTubeVideo = function () {
    return document.getElementsByClassName(YOUTUBE_MAIN_VIDEO_ELEMENT_CLASS_NAME)[0];
}

// ---------------- BEGIN CANVAS RENDERING ----------------

let chromaKey;
let threshold;
let power;
const setChromaKey = function (colorCodeArg, thresholdArg, powerArg) {
    // From the excellent answer here: https://stackoverflow.com/questions/5623838/rgb-to-hex-and-hex-to-rgb
    const hexToRgb = function (hex) {
        var result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: (parseInt(result[1], 16) / 255.0),
            g: (parseInt(result[2], 16) / 255.0),
            b: (parseInt(result[3], 16) / 255.0)
        } : null;
    }
    chromaKey = hexToRgb(colorCodeArg);
    threshold = thresholdArg;
    power = powerArg;
};
// Defaults
setChromaKey("000000", 0, 2.0);

const startCanvasRendering = function (video, canvas) {
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
        if (video.readyState > 2) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        }
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

        if (threshold > 0.0) {
            vec3 offset = gl_FragColor.rgb - chromaKey;
            float distSquared = dot(offset, offset);
            float t = min(1.0, pow(distSquared, 0.5 * power) / pow(threshold, power));
            gl_FragColor = t * gl_FragColor + (1.0 - t) * vec4(0.0, 0.0, 0.0, 0.0);
        }
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

        updateTexture(gl, texture, video);

        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(positionLocation);

        gl.useProgram(program);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(textureSamplerLocation, 0);

        gl.uniform3f(chromaKeyLocation, chromaKey.r, chromaKey.g, chromaKey.b);
        gl.uniform1f(thresholdLocation, threshold);
        gl.uniform1f(powerLocation, power);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        window.requestAnimationFrame(render);
    };
    window.requestAnimationFrame(render);
};

// ---------------- BEGIN MESSAGING ----------------

class MessageReceiver {
    _listeners;

    constructor () {
        this._listeners = new Map();

        chrome.runtime.onMessage.addListener(this._messageListener.bind(this));
    }

    _messageListener(message, sender, sendResponse) {
        if (message.sender === "addeo") {
            return;
        }
        if (message.async_id !== undefined) {
            this._handleMessageAsync(message);
        }
    }

    async _handleMessageAsync(message) {
        let response;
        if (this._listeners.has(message.kind)) {
            response = await this._listeners.get(message.kind)(message);
            response.async_id = message.async_id;
        } else {
            response = {async_id: message.async_id};
        }
        response.sender = "addeo";
        chrome.runtime.sendMessage(response);
    }

    setListener(kind, listener) {
        this._listeners.set(kind, listener);
    }

    send(message) {
        message.sender = "addeo";
        chrome.runtime.sendMessage(message);
    }
}

// ---------------- BEGIN MAIN PROGRAM ----------------

const initializeAddeo = function () {
    let addeo = getYouTubeVideo();
    // Hack to get around the fact that is seems like onload is the wrong event to use for this 
    // (timing is nondeterministic?!?), but I don't know what the right event is and onload is 
    // close enough to be usable for now with this minor workaround.
    // TODO: Is this needed if we're not using onload?
    if (!addeo) {
        console.warn("Failed to find addeo! Possible timing issue with onload; retrying.");
        setTimeout(initializeAddeo, 10);
        return;
    }

    const receiver = new MessageReceiver();

    receiver.setListener("play", async function () {
        addeo.play();
        return Promise.resolve({});
    });
    receiver.setListener("pause", async function () {
        addeo.pause();
        return Promise.resolve({});
    });
    receiver.setListener("seek", async function (message) {
        addeo.currentTime = message.currentTime;
        return Promise.resolve({});
    });
    receiver.setListener("playbackrate", async function (message) {
        addeo.playbackRate = message.playbackRate;
        return Promise.resolve({});
    });
    receiver.setListener("chromakey", async function (message) {
        setChromaKey(message.colorCode, message.threshold, message.power);
        return Promise.resolve({});
    });
    addeo.addEventListener("timeupdate", function () {
        receiver.send({
            kind: "timeupdated",
            currentTime: addeo.currentTime
        });
    });

    // Set up canvas rendering.
    {
        addeo.style.visibility = "hidden";
        // The YouTube embed iframe has some pretty aggressive background coloring, so we set
        // the whole ancestry's background to be transparent to be safe.
        const setBackgroundColorsTransparent = function (element) {
            element.style.backgroundColor = "transparent";
            if (element !== document.body) {
                setBackgroundColorsTransparent(element.parentElement);
            }
        };
        setBackgroundColorsTransparent(addeo.parentElement);

        const canvas = document.createElement("canvas");
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

        startCanvasRendering(addeo, canvas);
    }

    const loadedSender = function () {
        receiver.send({kind: "loaded"});
        addeo.removeEventListener("canplay", loadedSender)
    };
    addeo.addEventListener("canplay", loadedSender);

};

initializeAddeo();
