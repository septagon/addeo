chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
        chrome.tabs.sendMessage(tabs[0].id, message);
    });
});

// TODO: Consider using long-lived message passing for efficiency, if I
// can figure out whether the docs are telling me it's deprecated or not.
