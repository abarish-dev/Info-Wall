// Info Wall 1.3.0: which colour set the shared drawing code uses.
// true  = Mom Wall (simple mode) palette: green titles/years/phase, full-yellow suns/icons.
// false = main Info-Wall palette (as 1.1.21): amber titles, warm suns, amber icons.
// DisplayManager sets it from g_settings.simpleMode before each page is drawn.
#pragma once
static bool g_momPal = false;
