# Pomodoro Timer

## Overview

This is a lightweight web browser app. It's a "pomodoro" timer used for alternating between bursts of focused work and breaks. It should be very minimal visually, with the time prominent and controls easy to navigate with single clicks or taps.

## Tech stack and dependencies

* Uses vanilla HTML, CSS, and JS
* No external database

## Features

### Phase 1 —- DONE ✓
* Display a countdown (increments in minutes and seconds)
* Display which "mode" the user is in, work or break
    * Duration of work segment is 25 minutes
    * Duration of break segment is 5 minutes
* Start, pause, reset, skip to next segment
* Adjust segment duration: user can change the duration of work and break segments independently

### Phase 2 (current)
* Persist on browser reload (localstorage)
* Visual progress indicator on active timer
* Play sound when the countdown approaches zero

### Phase 3
* Pomo counter / show how much time has passed in work/break
* Dark/light mode

## Idea backlog
* Choose total duration: user can set the total time and the timer will automatically assign durations for work and break based on a 5:1 ratio