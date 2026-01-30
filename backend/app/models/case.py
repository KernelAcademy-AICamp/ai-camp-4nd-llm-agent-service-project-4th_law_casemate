from app.models.tiemline import TimeLine


class Case:
    def __init__(self):
        self.timelines: list[TimeLine] = []
