const AMAZON_VIDEO_PARENT_NAME = "rendererContainer";
const getDisneyPlusVideo = function () {
    const elements = document.getElementsByClassName(AMAZON_VIDEO_PARENT_NAME);
    if (elements.length < 1) {
        return undefined;
    }
    return elements[0].children[0];
}

// ---------------- BEGIN MAIN PROGRAM ----------------

const params = new URLSearchParams(window.location.search);
const ADDEO_YOUTUBE_ID = params.has("ytid") ? params.get("ytid") : undefined;
const POSITION = params.has("position") ? params.get("position") : "topright";
const SCALE = params.has("scale") ? params.get("scale") : "30";
const CHROMAKEY = params.has("chromakey") ? params.get("chromakey") : undefined;
const COMMANDS = params.has("commands") ? params.get("commands") : undefined;

if (ADDEO_YOUTUBE_ID === undefined || COMMANDS === undefined) {
    throw new Error("Unsupported addeo URL: both ytid and commands are required.");
}

const createAddeoYouTubeIFrame = function (additiveContent) {
    const iframe = document.createElement("iframe");
    iframe.src = "https://www.youtube.com/embed/" + ADDEO_YOUTUBE_ID + "?addeo&autoplay=1&controls=0";
    iframe.allow = "autoplay; encrypted-media;";
    iframe.allowFullscreen = true;
    iframe.style.position = "absolute";
    iframe.style.width = SCALE + "%";
    iframe.style.height = SCALE + "%";
    iframe.style.border = 0;
    iframe.style.overflow = "hidden";
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
}

const injectAddeo = function () {
    // Acquire the primary video.
    const video = getDisneyPlusVideo();
    if (video === undefined) {
        console.log("Unable to find video; retrying.");
        setTimeout(injectAddeo, 500);
        return;
    }

    // Create the additive content div.
    const additiveContent = document.createElement("div");
    additiveContent.style.position = "absolute";
    additiveContent.style.top = "0px";
    additiveContent.style.left = "0px";
    additiveContent.style.width = "100%";
    additiveContent.style.height = "100%";
    video.parentElement.appendChild(additiveContent);

    const controller = new SynchronizedVideoController(video, additiveContent, COMMANDS, CHROMAKEY);

    // Create the addeo iframe.
    if(ADDEO_YOUTUBE_ID) {
        createAddeoYouTubeIFrame(additiveContent);
    }
};

injectAddeo();
