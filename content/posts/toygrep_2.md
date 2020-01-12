---
title: "(What I learned) Creating Toygrep, a simple Ripgrep clone (Part 2)"
date: 2020-01-01T00:58:25-08:00
draft: true
---

This is Part 2 of the series on ToyGrep.  [Click here for Part 1.]({{< ref "toygrep_1.md" >}})

# Part 2: Reading smarter with AsyncLineBuffer

The V1 of ToyGrep was reasonably speedy for smaller files, but struggled with larger files. And worst of all, it used O(n) memory on the size of the file, which is absolutely not desirable.

It would be much smarter to have a sliding-window buffer that scans across the file, limiting the amount of memory used.

(It would also be possible to use memory maps, which Ripgrep will sometimes do based upon the scenario, but I found the line buffer to be the simplest all-around approach.)

Creating a file-reading buffer for regex line searching is not as simple a task as you might first guess.

The happiest scenario works fine: you populate your buffer, and it contains a whole line, and you match the line with regex and handle the result.

But what if you populate the buffer, and it contains the first half of a line, but not the second? You can't run your match on half the line.

Or, if you're reading raw bytes from a utf-8 stream, and your content includes multi-byte characters, what if your buffer cuts off part of a character? 😢 

You need some type of line-aware buffer, that knows how many complete and incomplete lines it contains, and which can grow to fit a whole line if it needs to.

In Toygrep, this is handled by `AsyncLineBuffer`.

### AsyncLineBuffer

Toygrep's `AsyncLineBuffer` is modeled after [Ripgrep's `LineBuffer`](https://github.com/BurntSushi/ripgrep/blob/master/grep-searcher/src/line_buffer.rs), with a few simplifications that don't seem to harm performance.

Let's use a visual representation of AsyncLineBuffer to understand how it works.

Assume this is the starting state of the buffer:

```Rust
AsyncLineBuffer {
    // Config values:
    line_break_byte: '\n',
    min_read_size: 16,

    // State values, displayed below
    buffer: vec shown below,
    line_break_idxs: queue shown below,
    start: 0,
    end: 0,
}

buffer:
    [________________] (len 16)
start^end

line_break_idxs:
[]
```

We pass the buffer something it can [`Read`](https://doc.rust-lang.org/std/io/trait.Read.html) from and ask it to fill itself.

Let's say the source we are reading from has this content:

```
Leave the gun.\n
Take the cannoli.\n
```

The buffer will fill itself up with as much content as possible, resulting in this state:

```Rust
AsyncLineBuffer {
    // Config values:
    line_break_byte: '\n',
    min_read_size: 16,

    // State values, displayed below
    buffer: vec shown below,
    line_break_idxs: queue shown below,
    start: 0,
    end: 16,
}

buffer:
    [Leave the gun.\nT] (len 16)
start^                ^end

line_break_idxs:
[14]
```

To reach this state, the `AsyncLineBuffer` populated the writable portion of its inner buffer. The "writable" portion is everything after `end`. Then it updates `end` to mark the index immediately following the portion it just wrote. It then scans over the bytes it just wrote, and if it finds any newlines, it pushes the index into the `line_break_idxs` queue.