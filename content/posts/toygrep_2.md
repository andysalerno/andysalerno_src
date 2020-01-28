---
title: "Creating Toygrep, a simple Ripgrep clone (Part 2)"
date: 2020-01-01T00:58:25-08:00
summary: "Part 2 in a series on Toygrep."
draft: true
---

This is Part 2 of the series on ToyGrep.  [Click here for Part 1.]({{< ref "toygrep_1.md" >}})

# Part 2: Reading smarter with AsyncLineBuffer

The "hello world" ToyGrep from Part 1 was reasonably speedy for smaller files, but struggled with larger files. And worst of all, it used O(n) memory on the size of the file, loading the entire file into memory, which is absolutely not desirable.

It would be much smarter to have a sliding-window buffer that scans across the file, limiting the amount of memory used at any given time.

(It would also be possible to use memory maps, which Ripgrep will sometimes do based upon the scenario, but to remain simple, the line buffer is adequate for nearly all scenarios.)

Creating a file-reading buffer for regex line searching is not as simple as you might first guess.

The happiest scenario is trivial: you populate your buffer, and it contains a whole line, and you match the line with regex and handle the result.

But what if you populate the buffer, and it contains the first half of a line, but not the second? You can't run your match on half the line.

Or, if you're reading raw bytes from a utf-8 stream, and your content includes multi-byte characters, what if your buffer cuts off part of a character? 😢 

You need some type of line-aware buffer, that knows how many complete and incomplete lines it contains, and which can grow to fit a whole line if it needs to.

In Toygrep, this is handled by `AsyncLineBuffer`.

### AsyncLineBuffer

Toygrep's `AsyncLineBuffer` is modeled after [Ripgrep's `LineBuffer`](https://github.com/BurntSushi/ripgrep/blob/master/grep-searcher/src/line_buffer.rs), with one or two simplifications.

The `AsyncLineBuffer` (hereafter "`Buffer`") wraps the underlying byte buffer, and handles the primitive behavior of the buffer, such as filling itself from a source and keeping track of its state. It exposes no public fields or methods outside of its crate. It is constructed via a simple `AsyncLineBufferBuilder`.

Another type, `AsyncLineBufferReader` (hereafter "`Reader`"), will hold the `Buffer` and expose the interesting functionality: `read_line()`.

Let's use a visual representation of `Reader` to understand how it works.

#### Visual example

At the lowest level, the buffer is a vector of bytes in memory, owned by the `Buffer`.

We're going to additionally imagine that this vector in memory is split into three segments.

Let's call the segments the **consumed** segment, the **working** segment, and the **remaining** segment.

For example, our buffer in memory may look like this:
```
buffer:
    [___hello.\n______] (len 16)
   start^       ^end
```

The **consumed** segment is everything before `start`; the **working** segment is from `start` until `end`, and the **remaining** segment is from `end` to the end of the vector. (In the above example, values outside the **working** segment are shown as `_` for simplicity, but will be "real" values in practice.)

#### Example 1: Happy path

Assume this is the starting state of the buffer:

```
buffer:
    [________________] (len 16)
start^end

line_break_idxs:
[]
```

We ask the `Reader` to `read_line()`. In turn, the `Reader` does all this:

It asks the `Buffer` if it has any lines ready (i.e. is there any terminal line position in `line_break_idxs`).

The `Buffer`, which is empty, says "No."

Since there's no line ready to go, we need to read more from the source. So `Reader` invokes `fill()` on its `Buffer`, which will populate the buffer from the source we provide it.

Let's say the source we are reading from has this content:

```
Hello.\n
```

The buffer will fill itself with that content, resulting in this state:

```
buffer:
    [Hello.\n_________] (len 16)
start^       ^end

line_break_idxs:
[6]
```

After reading into the byte vector, it scanned for any line breaks in the content, and found one at index `6`, so it pushed `6` into the queue of `line_break_idxs`.

The `Reader` asks again if there's a line ready in the buffer.

The `Buffer` says "yes", since it has a value in `line_break_idxs`.

`Reader` will now borrow the slice containing the line we just found and return it as the result of `read_line()`.

Internally, the buffer now has this state:

```
buffer:
    [Hello.\n_________] (len 16)
        start^end

line_break_idxs:
[]
```

The content that we read, `Hello.\n`, is now in the **consumed** portion of the buffer. The **working** portion is empty, and the **remaining** portion has some space ready to go.

Note that the consumed bytes didn't go anywhere. They're still there, taking up space in our byte buffer. We've simply slid forward the `start` position, growing the **consumed** segment into the **working** segment.


#### Example 2: Overflow

Let's see what happens when the content we're reading can't fit entirely in the buffer.

This is the content of our source:

```
Leave the gun.\n
Take the cannoli.\n
```

We are starting with a totally unused buffer:
```
buffer:
    [________________________] (len 24)
start^end

line_break_idxs:
[]
```

I've bumped up the size of this buffer to better visualize the behavior.

We ask the `Reader` to please `read_line()`.

Like before, the `Reader` sees there are no lines in the buffer, so it asks the `Buffer` to please `fill()` itself.

Like before, the buffer reads as much as it can from the source into its byte vector in the **remaining** segment.

(Since we started with a brand new buffer, the **remaining** segment is the entire buffer.)

This is the result:

```
buffer:
    [Leave the gun.\nTake the ] (len 24)
start^              ^14       ^end

line_break_idxs:
[14]
```

Like before, the `Reader` checks if we have any full lines now.

The `Buffer` says "yes, ending at position `14`."

Like before, `Reader` returns the slice containing the full line we found: `Leave the gun.\n`.

And we update the internal state, which now looks like this:

```
buffer:
    [Leave the gun.\nTake the ] (len 24)
                start^        ^end

line_break_idxs:
[]
```

Cool. Now we call `read_line()` on the `Reader` again, to get the next line.

And things get interesting.

Clearly, there's no space left in the buffer to read into. Our **remaining** segment is length `0`, and we're only partway through the next line.

So we must expand it, right?

Actually, we have another option -- we can re-use the **consumed** segment.

I didn't mention this before, but whenever `Reader` asks the `Buffer` to `fill()`, it first checks to see if it should roll the **working** segment back to the start.

What does this mean? If the **consumed** segment has a non-zero length, we can regain that space in the byte vector by sliding the **working** portion back to position `0`.

Visually, we go from this:
```
buffer:
    [Leave the gun.\nTake the ] (len 24)
                start^        ^end
```

To this:
```
buffer:
    [Take the gun.\nTake the ] (len 24)
start^        ^end
```

All we've done is copy the **working** segment to start at index `0`. No other values in the vector are touched, but since we don't really care about anything outside the **working** segment anyway, we may as well represent the result as this:
```
buffer:
    [Take the _______________] (len 24)
start^        ^end
```

This is actually one of the most important details of Ripgrep and Toygrep's implementations, and a very valuable lesson I learned from Ripgrep regarding performance. So valuable, in fact, that I'm going to completely digress into a little aside on what it means.

#### Quick aside: performance intuition {

As a programmer, when thinking about performance, it's easy to get stuck in the mindset that "copying == bad". Why should I spend so much time copying data from one side of a memory buffer to another? If you're like me, your first intuition might be something like this instead:

- When we find a complete line, instead of returning a borrowed slice into the vector, split the vector in-place at the linebreak and return an owning vector of the line.
- The `start` position of the buffer is now back at `0`, since we split off the entire **consumed** segment.

Or, visually, do this:
```
buffer:
    [Leave the gun.\n][Take the ] (len 9, after split)
                      ^split vector here, in place
    ^^^^^^^^^^^^^^^^^^you get this line as an owned vec
                      ^my inner buffer now starts here

line_break_idxs:
[]
```

Cool, the caller gets ownership of the line (which they want anyway), and we didn't do any copying. This feels like a "free" operation. Instead of letting crud build up in the **consumed** segment, there is no **consumed** segment at all. The next time we try to read, all we have to do is grow the byte vector to make more room.

This approach--let's call it the "split and grow" approach--is the one I implemented at first, since it felt the most intuitive to me. But it has a fatal performance flaw compared to the "copy to front" approach.

The flaw is: now that we've split the vector, we must grow it to keep writing into it.

Guess what growing a vector implies?

That's right: copying.  Which is what we were trying to avoid with this whole "splitting" charade anyway.

If it hasn't clicked, when you grow a vector (which is guaranteed to be a contiguous range of memory), it may require *reallocating* that vector elsewhere in memory to maintain the "contiguous range" guarantee. Imagine I add fifty more bytes to my vec, but I can't allocate fifty more bytes in a row without bumping into some other tenant. So we need to pick up shop and copy ourself somewhere with room.

In short, it's probably faster to re-use memory in a buffer you already have (which may involve copying), than to grow the buffer, which incurs the cost of allocating more memory and perhaps even *reallocating* and copying.

#### } Quick aside over

Let's see what the benchmark says about our `AsyncLineBuffer` when compared to the "stupidest thing that works" implementation from Part 1.

### Benchmarking AsyncLineBuffer

#### Historical results from Part 1

To refresh your memory, "stupid" Toygrep from Part 1 results, which read the entire file into memory:

|                                       | Query w/ few matches | Query w/ many matches |
|---------------------------------------|-------------|--------------|
| One small file (5.5mb)                |   0.040s    | 5.607s       |
| One large file (12.2gb)               | 1m11.489s   | N/A |
| Many nested small files (136 x 5.5mb) |   (not implemented yet)    | (not implemented yet)              |

Ripgrep's results:

|                                       | Query w/ few matches | Query w/ many matches |
|---------------------------------------|-------------|--------------|
| One small file (5.5mb)                |  0.035s     | 6.310s       |
| One large file (12.2gb)               |  33.413s  | N/A |
| Many nested small files (136 x 5.5mb) |   (not tested yet) | (not tested yet)              |

#### Using `AsyncLineBuffer`

First up we benchmark the "copy to front" approach. The results:

|                                       | Query w/ few matches | Query w/ many matches |
|---------------------------------------|-------------|--------------|
| One small file (5.5mb)                |  0.042s     | 6.385s       |
| One large file (12.2gb)               |  34.389s  | N/A |
| Many nested small files (136 x 5.5mb) |   (not tested yet) | (not tested yet)              |

Hey, cool! Compared to our "hello world" Toygrep from Part 1, the "one smile file" test gives basically the same result for the few-results query. Oddly, we somehow lose ~700ms on the many-results query, putting us right alongside Ripgrep 