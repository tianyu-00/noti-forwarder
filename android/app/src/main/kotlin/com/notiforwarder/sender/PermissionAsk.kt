package com.notiforwarder.sender

enum class AskStep { Prompt, OpenSettings }

/**
 * Android shows the permission dialog twice at most; after that a tap does nothing, which looks like a
 * stuck button. "No rationale" is also what Android says before the very first ask, so the app
 * remembers that it already asked: asked before and no dialog left means the user must switch the
 * permission on in the app's own settings page.
 */
fun nextAskStep(askedBefore: Boolean, canShowRationale: Boolean) =
    if (askedBefore && !canShowRationale) AskStep.OpenSettings else AskStep.Prompt
