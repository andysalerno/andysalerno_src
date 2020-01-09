---
title: "(What I learned) Creating a simple Ripgrep clone (Part 1)"
date: 2019-11-30T00:58:25-08:00
draft: true
---

### Toygrep

Toygrep [(github link)](https://github.com/andysalerno/toygrep) is an attempt to build a simple [Ripgrep](https://github.com/BurntSushi/ripgrep) clone using async/await, powered by [async-std](https://docs.rs/async-std/1.4.0/async_std/). While Ripgrep is a mature, fully-featured, production-ready tool, Toygrep is purely educational and intends to achieve as much as possible as simply as possible, while using only a few dependencies such as the regex crate.

### Features
- [x] Fast recursive file search of regex patterns (via regex crate)
- [x] Search piped input streams
- [x] Ignores binary files
- [x] Simple arguments for common regex scenarios like ignore-case and whole-word matching
- [x] Colored and grouped output by default

### Missing
I plan to implement the following in time:
- [ ] .gitignore parsing

I had a few motivations for creating Toygrep; I wanted to answer some questions, in no particular order:
1. Ripgrep makes use of an internal work scheduler, one of (many) design decisions that help it achieve its famous performance.  If I use async/await + async-std to do this for me, how close can I get?
1. On a scale of "painful" to "delightful", where is is async/await in Rust today for a project like this?
1. What subset of Ripgrep functionality/performance can be achieved in a short two-week period as a personal project?
1. What can I achieve in a personal a project over a few weeks' time during my winter holiday?
1. How is Ripgrep designed, and what design decisions give it such incredible performance?
1. What can I learn from Ripgrep?

In this series of posts, I will give an overview of the development process (including code samples), discuss things I learned or things that surprised me, and attempt to answer the questions listed above.

So let's jump in!


### Part 1: The dumbest thing that works

I started by implementing "the dumbest thing that works" for the simplest possible user scenario:  
*Search a single file for a simple regex pattern and print the result.*

To do this (and for the remainder of the project), I'm making use of Andrew Gallant's (aka "BurntSushi") Regex crate.

Yes, the same BurntSushi who created Ripgrep :)

The two obvious benefits of this are:
1. It's simple to use, and *fast* (if at times I sound a bit in awe of BurntSushi, it's because I am).
1. Since it's the same regex engine powering Ripgrep, it's a bit of a controlled variable in this experiment.

Here's the main file in [commit 460cb4b8](https://github.com/andysalerno/toygrep/blob/460cb4b860505be64cbd48cef65e15b3a1fe2578/src/main.rs), the first commit that can achieve the "simplest possible user scenario" described above. Surely the final implementation will look nothing like this, but this will help ground us and give us a jumping-off point.

The `main()` function:
```rust
#[async_std::main]
async fn main() -> IoResult<()> {
    let args = std::env::args();

    let user_input = arg_parse::capture_input(args);

    dbg!(&user_input);

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

So, how does this barely-functional, "hello-world" grep perform?

Well, to answer this, we need a benchmark. In the next section I describe my (relatively simple, just like Toygrep) benchmark system.

Read it if you're interested, or click here to skip to the results (TODO).

### Quick side quest: benchmarking grep tools

I created a simple benchmark suite to track Toygrep's performance. A quick disclaimer: this benchmark is only intended as a reference to show the evolution of Toygrep.  Creating a standardized benchmark for grep-like programs is very difficult [(BurntSushi has a whole section on it)](https://blog.burntsushi.net/ripgrep/). This isn't intended to be "complete" or "fair"; it only serves as a guide during development of this project.

#### Methodology

Benchmarking is broken down into a matrix of several common scenarios:

|                                       | |
|---------------------------------------|-------------|
| Query results                | one query gives few results, another gives many              |
| File size |             one file is "small" at 5.5MB, another is "large" at 13.3GB  |
| File count |  the query is run against one file, or a large recursive directory with many files (small-file scenarios only; 136 of the small files are copied into a directory tree with max depth 3)             |

The benchmark suite is all combinations of the above.

A benchmark directory contains 136 files. Each file is identical and contains the complete work of Shakespeare (link to MIT source).

Benchmark:
run once to warm up, then 10 times, and take average. 
one small file, few: "ostentation" (8 results)
one small file, many: "the" (39577 results)


|                                       | Few matches | Many matches |   |   |
|---------------------------------------|-------------|--------------|---|---|
| One small file (5.5mb)                |     0.059s        |              |   |   |
| One large file (13.3gb)               |             |              |   |   |
| Many nested small files (136 x 5.5mb) |   (not yet implemented)             |              |   |   |