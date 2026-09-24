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
