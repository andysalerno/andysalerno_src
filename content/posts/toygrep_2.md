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

Creating a file-reading buffer for regex line searching is not as simple as you might first guess.

The happiest scenario is trivial: you populate your buffer, and it contains a whole line, and you match the line with regex and handle the result.

But what if you populate the buffer, and it contains the first half of a line, but not the second? You can't run your match on half the line.

Or, if you're reading raw bytes from a utf-8 stream, and your content includes multi-byte characters, what if your buffer cuts off part of a character? 😢 

You need some type of line-aware buffer, that knows how many complete and incomplete lines it contains, and which can grow to fit a whole line if it needs to.

In Toygrep, this is handled by `AsyncLineBuffer`.

### AsyncLineBuffer

Toygrep's `AsyncLineBuffer` is modeled after [Ripgrep's `LineBuffer`](https://github.com/BurntSushi/ripgrep/blob/master/grep-searcher/src/line_buffer.rs), with a few simplifications that don't seem to harm performance.

The `AsyncLineBuffer` wraps the underlying byte buffer, and handles the primitive behavior of the buffer, such as filling itself from a source and keeping track of its state.

Another type, `AsyncLineBufferReader`, will hold the `AsyncLineBuffer` and give it some higher-level functionality that make it friendlier to use, such as extracting lines from the buffer.

Let's use a visual representation of AsyncLineBuffer to understand how it works.

#### Example 1: Happy path

Assume this is the starting state of the buffer:

```Rust
buffer:
    [________________] (len 16)
start^end

line_break_idxs:
[]
```

We pass the buffer something it can [`Read`](https://doc.rust-lang.org/std/io/trait.Read.html) from and ask it to `fill()` itself.

The declaration of `fill` looks like this:

```Rust
async fn fill<R>(&mut self, mut reader: R) -> bool
    where
        R: async_std::io::Read + std::marker::Unpin,
```

Let's say the source we are reading from has this content:

```
Hello.\n
```

The buffer will be in this state after it `fill`s itself:

```Rust
buffer:
    [Hello.\n_________] (len 16)
start^       ^end

line_break_idxs:
[6]
```

It read from the source into the byte vector, then looked for any line breaks in the content, and found one at index `6`, so it pushed `6` into the queue of `line_break_idxs`.

The `AsyncLineBufferReader` exposes `read_line()`, with a declaration like this:

```Rust
async fn read_line<'a>(&'a mut self) -> Option<LineResult<'a>>;
```

When the owner calls `read_line()`, the buffer reader will call `fill()` on its buffer until it contains at least one line, which we can detect if `line_break_idxs` isn't empty, or until the source is exhausted.

It then returns a `LineResult`, which looks like this:

```Rust
struct LineResult<'a> {
    line_num: usize,
    text: &'a [u8],
}
```

`text` is a reference is to the slice in the buffer that holds the line.

To get this reference, the buffer reader invokes `consume_line()` on the buffer, which looks like this:
```Rust
fn consume_line(&mut self) -> Option<&[u8]> {
    if let Some(line_break_pos) = self.line_break_idxs.pop_back() {
        // inclusive range to include the linebreak itself.
        let line = &self.buffer[self.start..=line_break_pos];
        self.start += line.len();

        Some(line)
    } else {
        None
    }
}
```

Our buffer now looks like this:
```Rust
buffer:
    [Hello.\n_________] (len 16)
        start^end

line_break_idxs:
[]
```

#### Example 2: Overflow

Let's see what happens when the content we're reading from can't fit entirely in the buffer.

This is our content:

```
Leave the gun.\n
Take the cannoli.\n
```

We ask the buffer reader to please `read_line()`.

The buffer reader sees there are no lines in the buffer, so it asks the buffer to please `fill()` itself.

The buffer reads as much as it can from the source into its byte vector.

This is the result:

```Rust
buffer:
    [Leave the gun.\nT] (len 16)
start^                ^end

line_break_idxs:
[14]
```

The buffer reader checks to see if we have any full lines now.

We do!

So just like in the first example, we call `consume_line()` on the buffer to get back a `LineResult`. The buffer state now looks like this:

```Rust
buffer:
    [Leave the gun.\nT] (len 16)
                start^^end

line_break_idxs:
[]
```

Cool. We ask the buffer reader to give us the next line.

And things get interesting.

I didn't mention this before, but whenever we ask the buffer to `fill()`, it first checks to see if we must roll the contents back to the start.

What does this mean? If the buffer contains any already-consumed lines (i.e. has a non-zero `start` value), we can regain some space by sliding `start` back to zero.

We call `roll_to_front()`, which copies everything in the `start` to `end` portion of the buffer to the front of the buffer, resulting in this state:
```Rust
buffer:
    [Teave the gun.\nT] (len 16)
start^^end

line_break_idxs:
[]
```

This is actually one of the most important details of Ripgrep and Toygrep's implementations, and a very valuable lesson I learned from Ripgrep regarding performance.

As a programmer, it's easy to get stuck in the mindset that "copying == bad". If you're like me, your first intuition might be something like this:

- When we find a complete line, instead of returning a slice into the buffer, split the buffer in-place at the linebreak and return an owning vector of the line
- The `start` position of the buffer is now back at `0`, since we split off everything before it.

Or, visually, do this:
```Rust
buffer:
    [Leave the gun.\n][T] (len 1)
                      ^split vector here, in place
    ^^^^^^^^^^^^^^^^^^you get this whole chunk back, as an owned vec
                      ^my new inner buffer starts here

line_break_idxs:
[]
```

Now the caller gets ownership of the line, and the next time you ask the buffer reader to hand you a line, the buffer will simply resize itself to some minimum amount of space:
```Rust
buffer:
    [Leave the gun.\n][Take the cannoli] (len 16)
                      ^split vector here, in place
    ^^^^^^^^^^^^^^^^^^you get this whole chunk back, as an owned vec
                        ^^^^^^^^^^^^^^^my next read gives me this

line_break_idxs:
[]
```