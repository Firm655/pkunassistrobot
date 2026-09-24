"""'Remember the number' game rules (no Kivy, unit tested).

P-kun flashes a sequence of digits 1-9. The patient then scrolls a number wheel to each digit in order.
Get the whole sequence right and the next round is one digit longer; three mistakes end the game.
"""
import random

MIN_DIGIT, MAX_DIGIT = 1, 9


class MemoryGame:
    def __init__(self, start_length=3, max_length=9, lives=3, rng=None):
        self.rng = rng or random.Random()
        self.length = start_length
        self.max_length = max_length
        self.lives = lives
        self.sequence: list[int] = []
        self.position = 0
        self.score = 0
        self.best_length = 0
        self.rounds_won = 0
        self.rounds_played = 0

    @property
    def finished(self) -> bool:
        return self.lives <= 0

    def new_round(self) -> list[int]:
        seq = []
        for _ in range(self.length):
            # No digit twice in a row: easier to see that the number changed.
            choices = [d for d in range(MIN_DIGIT, MAX_DIGIT + 1) if not seq or d != seq[-1]]
            seq.append(self.rng.choice(choices))
        self.sequence, self.position = seq, 0
        self.rounds_played += 1
        return seq

    def restart_round(self):
        """Replay the same sequence from the start (used after an interruption)."""
        self.position = 0

    @property
    def target(self) -> int:
        return self.sequence[self.position]

    def submit(self, digit: int) -> str:
        """Returns 'correct', 'round_complete' or 'wrong'."""
        if digit != self.target:
            self.lives -= 1
            self.length = max(3, self.length - 1) if self.lives > 0 else self.length
            return "wrong"
        self.position += 1
        if self.position < len(self.sequence):
            return "correct"
        self.rounds_won += 1
        self.score += len(self.sequence)
        self.best_length = max(self.best_length, len(self.sequence))
        self.length = min(self.length + 1, self.max_length)
        return "round_complete"


def wheel_step(value: int, steps: int) -> int:
    """Scroll the 1-9 wheel, wrapping around (9 -> 1 and 1 -> 9)."""
    span = MAX_DIGIT - MIN_DIGIT + 1
    return (value - MIN_DIGIT + steps) % span + MIN_DIGIT


# ---------------------------------------------------------------------------------- face direction
DIRECTIONS = ("up", "down", "left", "right")
OPPOSITE = {"up": "down", "down": "up", "left": "right", "right": "left"}


class DirectionGame:
    """A face looks up/down/left/right. Each round has a rule, shown before the round starts:
    'same' -> press the direction the face is looking; 'opposite' -> press the other way."""

    def __init__(self, rounds=3, trials_per_round=6, rng=None):
        self.rng = rng or random.Random()
        # Mix both rules; the first round is always the easier 'same' rule.
        rest = [self.rng.choice(("same", "opposite")) for _ in range(rounds - 1)]
        if rounds > 1 and "opposite" not in rest:
            rest[self.rng.randrange(len(rest))] = "opposite"
        self.rules = ["same"] + rest
        self.trials_per_round = trials_per_round
        self.round_index = 0
        self.trial_index = 0
        self.face: str | None = None
        self.results: list[list[bool]] = [[] for _ in self.rules]
        self.reaction_times: list[float] = []

    @property
    def rule(self) -> str:
        return self.rules[self.round_index]

    @property
    def finished(self) -> bool:
        return self.round_index >= len(self.rules)

    @property
    def score(self) -> int:
        return sum(sum(r) for r in self.results)

    @property
    def max_score(self) -> int:
        return len(self.rules) * self.trials_per_round

    def expected(self, face: str | None = None) -> str:
        face = face or self.face
        return face if self.rule == "same" else OPPOSITE[face]

    def next_face(self) -> str:
        choices = [d for d in DIRECTIONS if d != self.face]  # never the same face twice in a row
        self.face = self.rng.choice(choices)
        return self.face

    def answer(self, direction: str | None, reaction_time: float | None = None) -> bool:
        """direction=None means the patient ran out of time. Returns True if correct."""
        correct = direction == self.expected()
        self.results[self.round_index].append(correct)
        if correct and reaction_time is not None:
            self.reaction_times.append(reaction_time)
        self.trial_index += 1
        return correct

    @property
    def round_over(self) -> bool:
        return self.trial_index >= self.trials_per_round

    def next_round(self):
        self.round_index += 1
        self.trial_index = 0
        self.face = None


# ---------------------------------------------------------------------------------- colour (Stroop)
GAME_COLORS = ("Red", "Blue", "Green", "Yellow", "Purple", "Orange")


class ColorGame:
    """A box is filled with one colour and has a *different* colour's name written on it.
    The patient must choose the colour of the box, not the word."""

    def __init__(self, trials=10, options=4, rng=None):
        self.rng = rng or random.Random()
        self.trials, self.n_options = trials, options
        self.index = 0
        self.background = self.word = None
        self.options: list[str] = []
        self.correct = 0
        self.picked_word = 0          # chose the written word instead of the box colour
        self.results: list[bool] = []
        self.reaction_times: list[float] = []

    @property
    def finished(self) -> bool:
        return self.index >= self.trials

    def new_trial(self):
        prev = self.background
        self.background = self.rng.choice([c for c in GAME_COLORS if c != prev])
        self.word = self.rng.choice([c for c in GAME_COLORS if c != self.background])
        others = [c for c in GAME_COLORS if c not in (self.background, self.word)]
        opts = [self.background, self.word] + self.rng.sample(others, self.n_options - 2)
        self.rng.shuffle(opts)
        self.options = opts
        return self.background, self.word, self.options

    def answer(self, choice: str | None, reaction_time: float | None = None) -> bool:
        ok = choice == self.background
        self.results.append(ok)
        if ok:
            self.correct += 1
            if reaction_time is not None:
                self.reaction_times.append(reaction_time)
        elif choice == self.word:
            self.picked_word += 1
        self.index += 1
        return ok
