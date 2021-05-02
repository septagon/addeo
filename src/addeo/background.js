const onMessage = function (message, sender, sendResponse) {
    if (message.netflix_player_initialize) {
        chrome.tabs.executeScript(function () {
            const videoPlayer = netflix.appContext.state.playerApp.getAPI().videoPlayer;
            const sessionId = videoPlayer.getAllPlayerSessionIds()[0];
            global.netflix_player = videoPlayer.getVideoPlayerBySessionId(sessionId);
        });
    } else if (message.netflix_player_seek) {
        const milliseconds = 1000 * message.newTime;
        chrome.tabs.executeScript(function () {
            global.netflix_player.seek(Math.round(milliseconds));
        });
    }
};

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.background) {
        onMessage(message, sender, sendResponse);
    }
    chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
        chrome.tabs.sendMessage(tabs[0].id, message);
    });
});

// TODO: Consider using long-lived message passing for efficiency, if I
// can figure out whether the docs are telling me it's deprecated or not.
