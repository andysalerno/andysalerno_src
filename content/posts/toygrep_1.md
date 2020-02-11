---
title: "Creating Toygrep, a simple Ripgrep for fun (Part 1)"
date: 2019-11-30T00:58:25-08:00
summary: "Part 1 in a series on Toygrep."
draft: true
---

### Toygrep

Toygrep [(github link)](https://github.com/andysalerno/toygrep) is my attempt to build a simple [Ripgrep](https://github.com/BurntSushi/ripgrep) using async/await, powered by [async-std](https://docs.rs/async-std/1.4.0/async_std/) and the [regex crate](https://crates.io/crates/regex) (which also powers Ripgrep itself). Whereas Ripgrep is a mature, fully-featured, production-ready tool, Toygrep is purely for my own education purposes -- and possibly, by way of these blog posts, yours as well.

This page serves as the first part in a multi-part series on the development of Toygrep.

The tentative overview of the parts in this series:  
[Part 1: "Hello, world", or "The dumbest thing that works" (this part)]({{< ref "toygrep_1.md" >}})  
[Part 2: The LineBuffer]({{< ref "toygrep_2.md" >}})  
Part 3: The Printer (coming soon)  
Part 4: Filesystem traversing  (coming soon)

#### Motivation

My thoughts, circa 11pm one night in the middle of December:

"[Async is here.](https://areweasyncyet.rs/) The [async-std](https://docs.rs/async-std/1.4.0/async_std/) crate promises to make common `std` operations async.  I'd like to play around with this and learn what I can.

"I wonder if there's an interesting problem domain that relies heavily upon the operations that `async-std` should be good at, like reading/writing from buffers and dispatching tasks across threads...

"...ideally, that problem would be a practical everyday problem that's easy to understand...

"...even better if there's a well-designed, well-documented tool in the Rust ecosystem that solves the same problem, which I can use as an example; a 'north star', if you will, that I could also benchmark against...

"...wait a minute. That sounds like Ripgrep!"

Yes, Ripgrep, one of Rust's very own poster children of what the language can accomplish.

And thus, Toygrep, or the concept of Toygrep, was born :)

#### Functional goals

Like any good *grep, Toygrep must achieve these (and currently does, as of this writing):

- [x] Fast recursive file search of regex patterns
- [x] Search files or piped input streams
- [x] Binary file detection/skipping
- [x] Simple arguments for common regex scenarios like ignore-case and whole-word matching
- [x] Colored and grouped output by default

I plan to implement the following in time:
- [ ] respect .gitignore a la Ripgrep

No current plans to implement these, but maybe in the future:
- [ ] searching within archives a la Ripgrep

### Part 1: The dumbest thing that works

Rewinding the clock to Day 1. (If you're only interested in the very final result, I will link that part here once I publish it, or you can simply peruse [the latest code in the github repo.](https://github.com/andysalerno/toygrep)).

I started by implementing "the dumbest thing that works" for the simplest possible user scenario:  
*Search a single file for a simple regex pattern and print the result.*

To do this (and for the remainder of the project), I'm making use of Andrew Gallant's (aka "BurntSushi") Regex crate.

Yes, the same BurntSushi who created Ripgrep, and yes, the same Regex crate powering Ripgrep :)

The two obvious benefits of this are:
1. It's simple to use, and *fast* (if at times I sound a bit in awe of BurntSushi, it's because I am).
1. Since it's the same regex engine powering Ripgrep, it acts as a controlled variable in this experiment.

Here's the main file in [Toygrep commit 460cb4b8](https://github.com/andysalerno/toygrep/blob/460cb4b860505be64cbd48cef65e15b3a1fe2578/src/main.rs), the first commit that can achieve the "simplest possible user scenario" described above. 

The `main()` function:
```rust
#[async_std::main]
async fn main() -> IoResult<()> {
    let args = std::env::args();

    let user_input = arg_parse::capture_input(args);

    let regex = Regex::new(&user_input.search_pattern).expect(&format!(
        "Invalid search expression: {}",
        &user_input.search_pattern
    ));

    search_file(&user_input.search_targets[0], &regex).await?;

    Ok(())
}
```

All we do is parse the user inputs (not pictured), generate a regex matcher for it, and invoke `search_file()`. Pretty simple. I opted to use the `async_std::Main` attribute for simplicity.

`search_file()` is implemented like so:
```rust
async fn search_file(file_path: &str, pattern: &Regex) -> IoResult<()> {
    let content = fs::read_to_string(file_path).await?;

    let lines = content.lines();

    for line in lines {
        if pattern.is_match(line) {
            println!("Found match: {}", line);
        }
    }

    Ok(())
}
```

We read the whole file into memory(!!), make an iterator over its lines, and try the regex pattern against each one.

So, how does this barely-functional, "hello-world" grep perform?

Well, to answer this, we need a benchmark. In the next section I describe my (relatively simple, just like Toygrep) benchmark system.

Read it if you're interested, or [click here to skip to the results](#side-quest-complete-back-to-part-1).

### Quick side quest: benchmarking grep tools

I created a simple benchmark system to track Toygrep's performance. A quick disclaimer: this benchmark is only intended as a reference to show the evolution of Toygrep.  Creating a standardized benchmark for grep-like programs is very difficult [(BurntSushi has a whole section on it)](https://blog.burntsushi.net/ripgrep/). This isn't intended to be "complete" or "fair"; it only serves as a guide during development of this project.

#### Methodology

Benchmarking is broken down into a matrix of several common scenarios:

|                                       | Query w/ few matches | Query w/ many matches |
|---------------------------------------|-------------|--------------|
| One small file (5.5mb)                |             |              |
| One large file (12.2gb)               |             |  (N/A)       |
| Many nested small files (136 x 5.5mb) |             |              |

The 5.5mb "small" file contains the full works of Shakespeare, [from Project Gutenberg](http://www.gutenberg.org/ebooks/100).  
The 13.3gb "large" file is from the OpenSubtitles corpus found here (link TODO).

The options used are the default (no flags) for the tool being benchmarked. Of course, a test between two grep-likes would be unfair if one had certain functionality enabled (e.g. line number printing) and the other did not. I consider this an acceptible drawback because, again, the test is not intended to be "fair", but only to measure Toygrep's progress; additionally, the end goal is for Toygrep to implement most of Ripgrep's defaults anyway, limiting this disparity.

For each scenario, the tool is run once to "warm up", then the best of ten runs is selected.

Since the time taken to print many results to stdout is **not** negligible (making it an interesting part of the performance measurement), results are always printed to stdout.

Since even Ripgrep took over 10mins in the "large file, many matches" test, I've decided to strike out that particular case as uninteresting and unlikely.

In the Shake, few: "ostentation" (8 results)
one small file, many: "the" (39577 results)

large file: "It was just a dream"

### Side quest complete. Back to Part 1

#### Toygrep v1: benchmark results

Results for the earliest, stupid-simple version of Toygrep:

|                                       | Query w/ few matches | Query w/ many matches |
|---------------------------------------|-------------|--------------|
| One small file (5.5mb)                |   0.040s    | 5.607s       |
| One large file (12.2gb)               | 1m11.489s   | N/A |
| Many nested small files (136 x 5.5mb) |   (not implemented yet)    | (not implemented yet)              |

For comparison, here's Ripgrep's results:

|                                       | Query w/ few matches | Query w/ many matches |
|---------------------------------------|-------------|--------------|
| One small file (5.5mb)                |  0.035s     | 6.310s       |
| One large file (12.2gb)               |  33.413s  | N/A |
| Many nested small files (136 x 5.5mb) |   (not tested yet) | (not tested yet)              |

We learn a couple of things:
First, searching one small file is easy, especially when you're not doing line coloring or highlighting matches like Ripgrep. You can probably just read it into memory. No harm done.

Searching a large file (properly) is harder. Not shown in the above benchmarks is a worrisome fact you may already have deduced: in the large-file test, Toygrep V1 used **12.2 gigabytes** of memory for nearly the entire duration of its 1min+ runtime (we loaded the whole file into memory, remember?)

Ripgrep searched the same file, then printed the result with features like line numbering and match-coloring, in roughly half the time as Toygrep V1... and it only used a maximum of 1.2 **megabytes** while doing so.

This is definitely an expected result, but it reaffirms the fact that searching files big and small, many and few, with speedy performance and minimal memory usage, is **not** an easy task.  And we haven't even gotten to recursive directory searching yet :)

That's all for this part. Thanks for reading.

In Part 2, I'll introduce the line buffer to read from disk fast with much smaller, fixed memory usage.