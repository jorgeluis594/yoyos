/** Every control inside gets a target of at least 44 px, also with a mouse, where the global rule only covers touch and narrow screens. */
export const touchTargets = "[&_[data-slot=button]]:min-h-touch [&_[data-slot=tabs-trigger]]:min-h-touch [&_[data-slot=input]]:min-h-touch [&_[data-slot=select]]:min-h-touch [&_[data-slot=button][data-size^=icon]]:min-w-touch";
