---
name: course-check
description: Stop and check you are working on the right thing in the fastest way. Run it before starting a task, before waiting on anything, every ~30 minutes of work, after any surprise, and before reporting done.
---

# Course check

Answer each question in one line, honestly, then act on any "no". Don't skip one
because the answer seems obvious. Don't write the answers up as a report; fix
what they turn up.

## Direction
1. **What is the end goal right now?** Name the owner's actual outcome, not the task.
2. **Does what I'm doing move that goal the most it could?** If something else
   would move it more, switch.
3. **Is this what the owner asked for, or what I assumed?** Re-read their last
   few messages. Did they change direction or add a constraint I'm ignoring?

## Efficiency
4. **Am I doing this the fastest way that's still correct?** Is there a smaller
   change, an existing function, or a cheaper test?
5. **Am I waiting on anything?** If so: what's its deadline, what am I doing in
   parallel, and what do I do if it overruns? Anything past about 2× its
   expected time gets stopped and diagnosed, not waited on.
6. **Is anything running that doesn't need to be?** Old servers, stale loops,
   duplicate suites. Kill it.
7. **Could this be split or delegated** to run in parallel without two agents
   touching the same files?

## Quality
8. **How do I know it works?** Did I see it work (ran it, rendered it, played
   it), or do I only believe it does? "It typechecks" is not "it works."
9. **What would the owner notice first if they tried it right now?** Check that.
10. **Did I leave a gap I haven't said out loud?** Skipped steps, untested
    paths, known bugs. Say them now and put them in TODO.md.

## Flow
11. **Is finished work landing?** Small PRs merged today beat a big branch next
    week. Is anything sitting unmerged that should land now?
12. **Have I told the owner what changed?** One short update with a result
    (a number, a screenshot, a link), not a plan.
13. **Am I blocked on the owner for something I could do myself?** Do it. Only
    ask about real decisions or things only they can do.

## When to run it
- Before starting any task, and before splitting work out to agents.
- Before starting anything slow (tests, CI, renders, packaging, long runs).
- Every ~30 minutes of continuous work, and each time an agent reports back.
- After any surprise: a failure, a number that looks wrong, a blocked action.
- Before telling the owner something is done.
